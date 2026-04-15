# 🚦 AI-Driven Intelligent Traffic Management System

<div align="center">
  <img src="https://img.shields.io/badge/First_Prize-Winner-gold?style=for-the-badge&logo=trophy" alt="First Prize Winner" />
  <img src="https://img.shields.io/badge/Built_in-36_Hours-blue?style=for-the-badge&logo=clock" alt="36 Hour Hackathon" />
  <br />
  <h3>🥇 1st Prize Winner — 36-Hour Hackathon Project</h3>
  <p>A resilient system that dynamically handles real-time traffic signaling and emergency vehicle priority.</p>
</div>

---

## 📌 Overview

The **Intelligent Traffic Management System** is a real-time, AI-powered traffic simulation and optimization platform designed to solve urban congestion and ensure rapid emergency response. Built entirely from scratch during a **36-hour hackathon**, this project replaces traditional static, time-based traffic lights with intelligent, dynamic signaling driven by live computer vision.

## 🏆 Hackathon Achievement

We are extremely proud to announce that this project won **1st Prize** at the hackathon! 
Developed under intense time constraints (36 hours), the project was heavily praised by the judges for its:
- **Flawless Real-Time Execution:** Seamlessly bridging heavy Python computer vision processes with a lightweight Node.js/React architecture.
- **High-Impact Real-World Utility:** Directly solving a critical urban issue—emergency vehicle delays and road congestion.
- **High-Fidelity Engineering:** Implementing complex state management, a clean responsive UI, and advanced edge-case handling (e.g., robust ambulance overriding logic that prevents infinite loops).

## ✨ Key Features

- **🧠 AI-Driven Dynamic Signaling:** Leverages **YOLOv8** and OpenCV to analyze live video feeds, calculate dynamic vehicle densities per lane, and optimize green/red light allocations on the fly.
- **🚑 Emergency Preemption (Ambulance Priority):** Automatically detects emergency vehicles, safely interrupting the existing traffic cycle to grant immediate right-of-way, dramatically reducing emergency response times.
- **⏱️ Server-Authoritative Timing:** A robust Node.js signaling server maintains synchronous timing and state across all connected dashboard clients via WebSockets, eliminating desynchronization when switching tabs.
- **📊 Professional Dashboard:** A visually stunning, high-performance React UI featuring a responsive 2x2 video grid, live traffic counts, granular signal monitoring, and activity logging.
- **🟡 Realistic State Machine:** Models real traffic flow accurately with 3-second yellow light transitions smoothly integrated within the dynamic green timers.

## 🛠️ Technology Stack

**Frontend Engine**
- **React 19** + Vite (for lightning-fast HMR and optimized builds)
- **Tailwind CSS v4** (Utility-first styling for premium layouts)
- **Socket.IO-client** (Real-time duplex communication)

**Real-Time Backend Server**
- **Node.js** & **Express**
- **Socket.IO** (State synchronization and authoritative time-keeping)

**AI & Computer Vision Backend**
- **Python** (for robust ML processing)
- **YOLOv8** (by Ultralytics - state of the art object detection)
- **OpenCV** (Frame-by-frame video and stream manipulation)

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- Python (3.9+)
- `npm` and `pip` installers.

### 1. Start the Real-Time Backend
```bash
cd backend/node
npm install
npm start
```

### 2. Start the Python AI/CV Engine
```bash
cd backend/python
pip install -r requirements.txt # (Ensure opencv-python, ultralytics, etc. are installed)
python main.py
```
*(Ensure that model weights like `yolov8n.pt` and video sources like `traffic.mp4` are properly available in the project root/backend where expected)*

### 3. Start the Frontend Dashboard
```bash
cd traffic-system
npm install
npm run dev
```
Visit `http://localhost:5173` in your browser to view the real-time simulation.

---
*Built with passion, AI, and lots of coffee in 36 hours limit. ☕*
