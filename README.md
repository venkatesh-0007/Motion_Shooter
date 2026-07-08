# Motion Shooter Arena

Welcome to **Motion Shooter Arena**, a highly interactive, dual-device arcade shooter that turns your smartphone into a motion-sensing weapon! 

Step into a futuristic, neon-lit arena directly on your computer screen, while using your phone as a precision controller. Aim, shoot, and compete for the high score!

## 🎮 How It Works

Motion Shooter Arena bridges the gap between your desktop and mobile devices without requiring any app downloads:

1. **The Arena (Desktop):** Your computer screen serves as the game world, displaying the targets, crosshair, and your score.
2. **The Blaster (Mobile):** Your smartphone transforms into the controller. Using its built-in gyroscopes and sensors, every tilt and movement of your phone translates directly into aiming on the big screen.

---

## 🚀 How to Run Locally

This project runs entirely on a local network. No external online deployment is needed.

### 1. Prerequisites
- **Node.js** (v16 or higher recommended)
- A laptop/PC and a smartphone connected to the **same Wi-Fi network**.

### 2. Installation
Clone the repository and install the dependencies:
```bash
git clone https://github.com/venkatesh-0007/Motion_Shooter.git
cd Motion_Shooter
npm install
```

### 3. Run the Server
Start the development server with hot-reloading:
```bash
npm run dev
```
Or start the server in production mode:
```bash
npm start
```
The server will print the URLs and a pairing QR code in the console.

---

## 📱 Accessing the Game & Controller

1. **Open the Arena:**
   On your computer, open a web browser and navigate to:
   `http://localhost:3001/game` (or use the LAN IP URL printed in the server terminal, e.g. `http://172.17.154.46:3001/game`).

2. **Connect the Controller:**
   - Scan the pairing QR code displayed on the desktop game lobby screen.
   - Alternatively, open the LAN IP controller URL (e.g. `http://172.17.154.46:3001/controller`) on your smartphone.

3. **Secure Context & Gyroscope Permission (Critical):**
   Mobile browsers block the DeviceOrientation API (gyroscope sensor) on non-HTTPS connections. Since the server runs locally on HTTP, you must authorize your browser to trust the local IP:
   - **On Chrome (Mobile):**
     1. Open a new tab and navigate to `chrome://flags/#unsafely-treat-insecure-origin-as-secure`.
     2. Enable the flag.
     3. Paste your server LAN origin (e.g., `http://172.17.154.46:3001`) into the text box.
     4. Relaunch Chrome.
   - **On iOS (Safari):**
     - Ensure **Motion & Orientation Access** is enabled in Safari settings, and grant permission when prompted.

---

## ✨ Features

- **Zero-Friction Setup:** No apps to download. Just scan a QR code with your phone and you are instantly paired and ready to play.
- **True Motion Controls:** Experience responsive motion aiming using your phone's built-in orientation sensors.
- **Weapon System:**
  - **Pistol:** Semi-automatic fire mode (one shot per tap, 350 ms cooldown).
  - **SMG:** Automatic fire mode (hold screen to continuously shoot every 120 ms).
- **Intuitive Gameplay:** 
  - **Aim:** Physically tilt and point your phone to move the crosshair.
  - **Shoot:** Tap or hold the dedicated **FIRE** button on your phone screen.
  - **Recenter:** Tap the "Recenter" button at the bottom of your phone to instantly recalibrate your aim to the center of the screen.
- **Cyberpunk Aesthetic:** Immerse yourself in a sleek, dark, neon-glowing visual style.

---

*Get ready to aim, shoot, and dominate the Motion Shooter Arena!*
