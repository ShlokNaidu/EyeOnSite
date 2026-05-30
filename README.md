# EyeOnSite Main Project

Welcome to the unified `eyeonsite_main` project! This repository contains the Frontend, Backend, and AI Service, all designed to run cohesively.

## 📁 Directory Structure
- `frontend/` - React/Vite-based user interface.
- `backend/` - Node.js Express server to handle APIs and websocket alerts.
- `ai_service/` - Python FastAPI app running YOLO/Ultralytics computer vision pipelines.

## 🚀 Setup & Execution

### 1. Environment Configuration

Before running any services, you must provide the environment configuration file.

Place your existing `.env` file into the root of this `eyeonsite_main` folder. The `.env` file should at least contain variables like:

```env
PORT=5000
PYTHON_PORT=8000
EXPRESS_URL=http://backend:5000
MONGO_URI=mongodb://mongodb:27017/eyeonsite
JWT_SECRET=your_jwt_secret
INTERNAL_API_KEY=your_internal_key
# Other specific AI settings...
```

NOTE: If running with `docker-compose`, change your URLs in the `.env` to route to the Docker service names:
- Instead of localhost:5000 for EXPRESS_URL, use `http://backend:5000`.
- Instead of localhost:27017 for MONGO_URI, use `mongodb://mongodb:27017/eyeonsite`.

### 2. Using Docker Compose (Recommended)

To run the entire ecosystem locally using Docker, simply use:

```bash
docker-compose up --build
```
This will automatically build and start:
1. `mongodb` (on port 27017)
2. `backend` (on port 5000)
3. `ai_service` (on port 8000)
4. `frontend` (on port 5173)

**GPU Support:** If you want GPU acceleration for the AI Service, ensure `nvidia-container-toolkit` is installed on your host system and uncomment the `deploy` block inside `docker-compose.yml` -> `ai_service` definition.

### 3. Manual Local Setup

If you prefer to run elements without Docker Compose, you must start each service individually:

**Terminal 1 - Backend:**
```bash
cd backend
npm install
npm start
```

**Terminal 2 - AI Service:**
```bash
cd ai_service
pip install -r requirements.txt
python main.py
```

**Terminal 3 - Frontend:**
```bash
cd frontend
npm install
npm run dev
```

Remember to revert database and url strings in your `.env` file to refer to `localhost` if you choose this un-containerized path.

### 4. Automated Local Setup

To quickly download all prerequisites without running commands in each folder manually, you can use the provided setup script.

**Terminal - Root Directory:**
```bash
python setup_project.py
```
This script will automatically navigate to each folder and install all necessary dependencies for the Backend, Frontend, and AI Service.
