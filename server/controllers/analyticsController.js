const Alert = require('../models/Alert');
const { getSiteFilter } = require('../utils/siteFilter');

// Violation type weights for safety score
const TYPE_WEIGHTS = {
  helmet_missing: 1.2,
  vest_missing: 1.1,
  restricted_zone: 1.5,
  machinery_proximity: 1.8,
  predicted_machinery_collision: 1.3,
  predicted_zone_entry: 1.0,
  no_movement: 1.4,
  fall_no_movement: 2.0,
  proximity_ppe_violation: 1.3,
};

// Using centralized getSiteFilter utility

exports.getStats = async (req, res) => {
  try {
    const { camera_id, from, to, time_filter } = req.query;

    const siteFilter = await getSiteFilter(req.user);
    const filter = { ...siteFilter };
    if (camera_id) filter.camera_id = camera_id;
    
    if (time_filter) {
      filter.timestamp = {};
      const now = new Date();

      if (time_filter === 'today') {
        const startOfDay = new Date(now);
        startOfDay.setUTCHours(0, 0, 0, 0);
        const endOfDay = new Date(now);
        endOfDay.setUTCHours(23, 59, 59, 999);
        filter.timestamp.$gte = startOfDay;
        filter.timestamp.$lte = endOfDay;
      } else if (time_filter === 'last7days') {
        const start = new Date(now);
        start.setUTCDate(start.getUTCDate() - 6);
        start.setUTCHours(0, 0, 0, 0);
        const end = new Date(now);
        end.setUTCHours(23, 59, 59, 999);
        filter.timestamp.$gte = start;
        filter.timestamp.$lte = end;
      }
    } else if (from || to) {
      filter.timestamp = {};
      if (from) filter.timestamp.$gte = new Date(from);
      if (to) filter.timestamp.$lte = new Date(to);
    }

    // Total alerts count
    const total_alerts = await Alert.countDocuments(filter);

    // Group by type
    const typePipeline = [
      { $match: filter },
      { $group: { _id: '$type', count: { $sum: 1 } } }
    ];
    const typeResults = await Alert.aggregate(typePipeline);
    const by_type = {};
    typeResults.forEach(r => { by_type[r._id] = r.count; });

    // Alerts per day
    const dayPipeline = [
      { $match: filter },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ];
    const dayResults = await Alert.aggregate(dayPipeline);
    const alerts_per_day = dayResults.map(r => ({ date: r._id, count: r.count }));

    // Safety score calculation
    let weighted_sum = 0;
    for (const [type, count] of Object.entries(by_type)) {
      weighted_sum += (TYPE_WEIGHTS[type] || 1.0) * count;
    }
    const worker_observations = Math.max(total_alerts, 1);
    const weighted_violation_rate = (weighted_sum / worker_observations) * 100;
    const safety_score = Math.round(Math.max(0, 100 - weighted_violation_rate));

    // Site-wise alert counts (for admin analytics)
    const sitePipeline = [
      { $match: filter },
      { $group: { _id: '$site_id', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ];
    const siteResults = await Alert.aggregate(sitePipeline);

    // Resolve site names
    const Site = require('../models/Site');
    const siteIds = siteResults.map(r => r._id).filter(Boolean);
    const sitesList = siteIds.length > 0 ? await Site.find({ site_id: { $in: siteIds } }).lean() : [];
    const siteNameMap = {};
    sitesList.forEach(s => { siteNameMap[s.site_id] = s.name; });

    const by_site = siteResults.map(r => ({
      site_id: r._id || 'unassigned',
      site_name: siteNameMap[r._id] || r._id || 'Unassigned',
      count: r.count
    }));

    res.json({
      success: true,
      data: {
        total_alerts,
        by_type,
        alerts_per_day,
        safety_score,
        by_site
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'DB_ERROR', message: err.message }
    });
  }
};
