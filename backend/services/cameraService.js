// services/cameraService.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');

class CameraService {
  constructor() {
    this.camera1Url = process.env.CAMERA1_SNAPSHOT || null;
    this.camera2Url = process.env.CAMERA2_SNAPSHOT || null;
    this.snapshotDir = path.join(__dirname, '../public/snapshots');
    
    // Ensure snapshot directory exists
    if (!fs.existsSync(this.snapshotDir)) {
      fs.mkdirSync(this.snapshotDir, { recursive: true });
    }
  }

  async captureSnapshot(cameraNum) {
    const url = cameraNum === 1 ? this.camera1Url : this.camera2Url;
    
    if (!url) {
      console.log(`Camera ${cameraNum} URL not configured`);
      return null;
    }

    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 5000,
        auth: this.getAuth(cameraNum)
      });

      const timestamp = Date.now();
      const filename = `cam${cameraNum}_${timestamp}.jpg`;
      const filepath = path.join(this.snapshotDir, filename);
      
      fs.writeFileSync(filepath, response.data);
      
      // Return base64 for immediate display
      const base64 = Buffer.from(response.data).toString('base64');
      return {
        filename,
        path: `/snapshots/${filename}`,
        base64: `data:image/jpeg;base64,${base64}`,
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      console.error(`Camera ${cameraNum} capture failed:`, err.message);
      return null;
    }
  }

  getAuth(cameraNum) {
    const user = process.env[`CAMERA${cameraNum}_USER`];
    const pass = process.env[`CAMERA${cameraNum}_PASS`];
    if (user && pass) return { username: user, password: pass };
    return undefined;
  }

  async captureBoth() {
    const [cam1, cam2] = await Promise.allSettled([
      this.captureSnapshot(1),
      this.captureSnapshot(2)
    ]);

    return {
      camera1: cam1.status === 'fulfilled' ? cam1.value : null,
      camera2: cam2.status === 'fulfilled' ? cam2.value : null
    };
  }

  // ── Hot-reload URLs from updated process.env (called by settings route)
  reload() {
    this.camera1Url = process.env.CAMERA1_SNAPSHOT || null;
    this.camera2Url = process.env.CAMERA2_SNAPSHOT || null;
    console.log('📷 Camera URLs reloaded:', this.camera1Url, this.camera2Url);
  }
}

module.exports = new CameraService();
