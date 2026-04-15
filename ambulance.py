import cv2
import threading
from inference_sdk import InferenceHTTPClient

CLIENT = InferenceHTTPClient(
    api_url="https://serverless.roboflow.com",
    api_key="yVwkM1ahb9RV40ESfTpr"
)

cap = cv2.VideoCapture("traffic.mp4")

frame_count = 0
ambulance_detected = False
bbox = None  # 🔥 store bounding box

cv2.namedWindow("Ambulance Detection", cv2.WINDOW_NORMAL)
cv2.resizeWindow("Ambulance Detection", 900, 600)

# 🔥 Detection function
def detect(frame):
    global ambulance_detected, bbox

    try:
        result = CLIENT.infer(
            frame,
            model_id="ambulance-detection-u4ao4-9qdka/1"
        )

        ambulance_detected = False
        bbox = None

        for pred in result["predictions"]:
            if pred["class"].lower() == "ambulance":

                ambulance_detected = True

                x = int(pred["x"])
                y = int(pred["y"])
                w = int(pred["width"])
                h = int(pred["height"])

                # Convert center → box
                x1 = int(x - w/2)
                y1 = int(y - h/2)
                x2 = int(x + w/2)
                y2 = int(y + h/2)

                bbox = (x1, y1, x2, y2)

                print("🚑 Ambulance Detected!")

    except Exception as e:
        print("API Error:", e)

while True:
    ret, frame = cap.read()
    if not ret:
        break

    frame_count += 1

    # 🚀 Run detection every 20 frames
    if frame_count % 20 == 0:
        threading.Thread(target=detect, args=(frame.copy(),)).start()

    # ✅ Resize for display
    display_frame = cv2.resize(frame, (900, 600))

    # 🎯 DRAW BOX HERE (MAIN LOOP)
    if ambulance_detected and bbox is not None:
        x1, y1, x2, y2 = bbox

        cv2.rectangle(display_frame, (x1, y1), (x2, y2), (0,255,0), 3)
        cv2.putText(display_frame, "🚑 AMBULANCE", (x1, y1-10),
                    cv2.FONT_HERSHEY_SIMPLEX, 1,
                    (0,255,0), 2)

    cv2.imshow("Ambulance Detection", display_frame)

    if cv2.waitKey(1) == 27:
        break

cap.release()
cv2.destroyAllWindows()