import time
import requests
import cv2
import threading
import base64
import random
from fastapi import FastAPI
import uvicorn
from ultralytics import YOLO

app = FastAPI()

# Configuration
NODE_URL = "http://localhost:5000/detections"
ROBOFLOW_API_KEY = "yVwkM1ahb9RV40ESfTpr"
ROBOFLOW_URL = "https://serverless.roboflow.com/ambulance-detection-u4ao4-9qdka/1"

LANES = ["north", "east", "south", "west"]
VIDEO_PATHS = {
    "north": "../../traffic-system/public/north.mp4",
    "east": "../../traffic-system/public/east.mp4",
    "south": "../../traffic-system/public/south.mp4",
    "west": "../../traffic-system/public/west.mp4"
}

# COCO class IDs for vehicles
VEHICLE_CLASSES = {2: "Car", 3: "Motorcycle", 5: "Bus", 7: "Truck"}

# Global State for Detections (now includes bounding boxes)
latest_detections = {
    "north": {"vehicles": 0, "ambulance": False, "confidence": 0.0, "boxes": [], "ambulanceBoxes": []},
    "east":  {"vehicles": 0, "ambulance": False, "confidence": 0.0, "boxes": [], "ambulanceBoxes": []},
    "south": {"vehicles": 0, "ambulance": False, "confidence": 0.0, "boxes": [], "ambulanceBoxes": []},
    "west":  {"vehicles": 0, "ambulance": False, "confidence": 0.0, "boxes": [], "ambulanceBoxes": []},
    "weather": "Clear",
    "timestamp": 0
}

# Load YOLO model
try:
    yolo_model = YOLO('yolov8n.pt')
    print("✅ YOLOv8n loaded successfully")
except Exception as e:
    print("❌ Failed to load YOLO:", e)
    yolo_model = None


def process_camera(lane_id, video_path):
    """Background thread: process one camera feed."""
    cap = cv2.VideoCapture(video_path)

    if not cap.isOpened():
        print(f"❌ Cannot open video for {lane_id}: {video_path}")
        return

    frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"📹 {lane_id}: {frame_w}x{frame_h}")

    frame_count = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            continue

        frame_count += 1

        # Process every 30 frames (~1 detection/sec at 30fps)
        if frame_count % 30 != 0:
            time.sleep(0.005)
            continue

        vehicle_boxes = []
        ambulance_boxes = []
        vehicles_count = 0
        ambulance_detected = False
        amb_conf = 0.0

        # ─────────────── YOLO VEHICLE DETECTION ───────────────
        if yolo_model:
            try:
                results = yolo_model(frame, verbose=False, conf=0.3)
                for r in results:
                    for box in r.boxes:
                        conf = float(box.conf[0])
                        cls_id = int(box.cls[0])

                        if cls_id in VEHICLE_CLASSES and conf > 0.3:
                            vehicles_count += 1
                            # Get bounding box in xyxy format (pixels)
                            x1, y1, x2, y2 = box.xyxy[0].tolist()

                            # Normalize to percentages (0-100) for frontend scaling
                            vehicle_boxes.append({
                                "x1": round((x1 / frame_w) * 100, 2),
                                "y1": round((y1 / frame_h) * 100, 2),
                                "x2": round((x2 / frame_w) * 100, 2),
                                "y2": round((y2 / frame_h) * 100, 2),
                                "class": VEHICLE_CLASSES[cls_id],
                                "confidence": round(conf, 2)
                            })
            except Exception as e:
                print(f"YOLO error on {lane_id}: {e}")

        # ─────────────── ROBOFLOW AMBULANCE DETECTION ───────────────
        try:
            _, img_encoded = cv2.imencode('.jpg', frame)
            img_b64 = base64.b64encode(img_encoded).decode('utf-8')

            resp = requests.post(
                f"{ROBOFLOW_URL}?api_key={ROBOFLOW_API_KEY}",
                data=img_b64,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=5
            )
            data = resp.json()

            if 'predictions' in data:
                for p in data['predictions']:
                    if p['confidence'] > 0.5:
                        ambulance_detected = True
                        amb_conf = max(amb_conf, p['confidence'])

                        # Roboflow returns center-based coords
                        cx = p['x']
                        cy = p['y']
                        bw = p['width']
                        bh = p['height']

                        # Convert center → corners, then normalize to percentages
                        ax1 = (cx - bw / 2) / frame_w * 100
                        ay1 = (cy - bh / 2) / frame_h * 100
                        ax2 = (cx + bw / 2) / frame_w * 100
                        ay2 = (cy + bh / 2) / frame_h * 100

                        ambulance_boxes.append({
                            "x1": round(max(0, ax1), 2),
                            "y1": round(max(0, ay1), 2),
                            "x2": round(min(100, ax2), 2),
                            "y2": round(min(100, ay2), 2),
                            "class": "Ambulance",
                            "confidence": round(p['confidence'], 2)
                        })
        except Exception as e:
            print(f"Roboflow API error {lane_id}: {e}")

        # Fallback if YOLO missed and model is None
        if vehicles_count == 0 and yolo_model is None:
            vehicles_count = random.randint(2, 18)

        # Update global state
        latest_detections[lane_id] = {
            "vehicles": vehicles_count,
            "ambulance": ambulance_detected,
            "confidence": round(amb_conf, 2),
            "boxes": vehicle_boxes,
            "ambulanceBoxes": ambulance_boxes
        }

        time.sleep(0.01)


# Start camera threads
for lane, path in VIDEO_PATHS.items():
    t = threading.Thread(target=process_camera, args=(lane, path), daemon=True)
    t.start()
    print(f"🚀 Started camera thread: {lane}")


# Sync to Node.js every second
def sync_to_node():
    while True:
        try:
            # Simulate occasional rain for demo
            if random.random() > 0.97:
                latest_detections["weather"] = "Rain" if latest_detections["weather"] == "Clear" else "Clear"

            latest_detections["timestamp"] = int(time.time() * 1000)
            requests.post(NODE_URL, json=latest_detections, timeout=2)
        except Exception as e:
            print("Failed to sync to Node. Is server.js running?", e)
        time.sleep(1)


t_sync = threading.Thread(target=sync_to_node, daemon=True)
t_sync.start()


@app.get("/")
def read_root():
    return {"status": "ok", "detections": latest_detections}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
