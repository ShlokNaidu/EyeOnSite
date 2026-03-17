# EyeOnSite - A Smart Construction Site Safety Monitoring System

A full-stack, AI-powered real-time safety surveillance platform designed to automatically detect and alert on PPE violations, zone intrusions, and dangerous proximity to machinery on construction sites using computer vision.

##  Key Features

*   **Real-Time AI Detection:** YOLO-based object detection on live camera feeds (RTSP, USB, or video files).
*   **PPE Compliance Monitoring:** Explicit detection classes for missing helmets and safety vests to ensure high accuracy.
*   **Smart Zone Intrusions:** Perspective-aware foot-point logic to accurately determine if a worker has entered a restricted or proximity zone.
*   **Machinery Safety:** Detects workers in dangerous proximity to *moving* machinery.
*   **Predictive Collision Warnings:** Uses Exponential Moving Average (EMA) smoothed velocity tracking to predict and warn about potential collisions or zone entries before they happen.
*   **Live Dashboard & Alerts:** WebSocket-based real-time alert delivery and live MJPEG video streams directly in the browser.
*   **Interactive Zone Editor:** Draw and manage safety zones per camera directly from the UI.
*   **Analytics & Reporting:** Persistent alert history, safety scoring, and daily trend analysis to monitor overall site safety.

## System Architecture

The platform consists of three independent microservices communicating seamlessly over HTTP and WebSockets:

1.  **AI Service (Python/FastAPI):**
    *   Handles computer vision tasks using Ultralytics YOLO and ByteTrack.
    *   Runs per-camera processing threads for object tracking, spatial logic, and predictive analysis.
    *   Dispatches alerts to the backend and serves MJPEG streams.
2.  **Backend Server (Node.js/Express):**
    *   Manages the MongoDB Atlas database for cameras, zones, and alert history.
    *   Handles REST API requests and file uploads.
    *   Broadcasts real-time alerts to connected clients via WebSockets.
3.  **Frontend App (React/Vite):**
    *   Provides a responsive, Tailwind CSS-styled dashboard for monitoring.
    *   Features real-time charts (Recharts), live video feeds, and audio alerts.

## Technology Stack

| Component | Technology | Component | Technology |
| :--- | :--- | :--- | :--- |
| **AI Inference** | Ultralytics YOLO (v8+) | **Backend Server** | Node.js, Express.js |
| **Object Tracking** | ByteTrack | **Database** | MongoDB Atlas, Mongoose |
| **AI Service API** | Python, FastAPI, Uvicorn | **Real-time Comms** | WebSockets (ws) |
| **Video Processing** | OpenCV | **Frontend App** | React, Vite, React Router DOM |
| **Styling & UI** | Tailwind CSS, Lucide React | **Charts** | Recharts |

## Getting Started

Follow these steps to run the complete system locally.

### Prerequisites

*   Node.js (v18+)
*   Python (v3.10+)
*   MongoDB Atlas account (or local MongoDB instance)
*   A custom-trained YOLO model file (e.g., `custom_safety_best.pt`) placed in the `ai_service` directory.

### 1. Start the Backend Server

```bash
cd server
npm install
npm run dev
```
*The Express server will start on `http://localhost:5000`.*

### 2. Start the AI Service

```bash
cd ai_service
# Create and activate a virtual environment (recommended)
# python -m venv venv
# .\venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```
*The FastAPI service will start on `http://localhost:8000`. Make sure to avoid port conflicts with the backend.*

### 3. Start the Frontend Application

```bash
cd frontend
npm install
npm run dev
```
*The React app will start on `http://localhost:5173`.*

### 4. Configuration (.env)

Ensure you have a `.env` file in the root directory and the `frontend` directory with the necessary configurations.

**Root `.env` Example:**
```env
PORT=5000
MONGO_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/construction_safety
INTERNAL_API_KEY=supersecretkey123
PYTHON_PORT=8000
EXPRESS_URL=http://localhost:5000
FRAME_SKIP=2
VITE_EXPRESS_URL=http://localhost:5000
VITE_PYTHON_STREAM_URL=http://localhost:8000
```

## Usage

1.  Open your browser and navigate to `http://localhost:5173`.
2.  Go to the **Cameras** page and click **Add Camera** (you can upload a demo video or provide an RTSP stream).
3.  In the camera details view, use the interactive editor to draw **Restricted** or **Proximity** zones.
4.  Click **Activate** to start AI detection on that camera feed.
5.  Monitor real-time violations on the **Dashboard** and track historical data on the **Analytics** page.

## Key Design Concepts

*   **Explicit PPE Classes:** Instead of inferring the absence of PPE when a detection is missed, the custom model is trained on explicit `no_helmet` and `no_vest` classes to significantly reduce false positives.
*   **Perspective-Aware Zones:** Uses the bottom point of the worker's bounding box to calculate ground contact, preventing false zone alerts from perspective overlapping.
*   **Moving Machinery Filter:** Calculates position displacement over frames to ensure alerts are only triggered by active, moving machinery, ignoring parked vehicles.
*   **Smart Alert Debouncing:** Implements time floors, consecutive count-jumps, and grace periods to prevent alert spamming while ensuring critical violations are caught instantly.

---
*Developed for advanced construction site safety monitoring.*
