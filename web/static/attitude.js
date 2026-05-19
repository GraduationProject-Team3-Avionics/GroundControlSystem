class AttitudeIndicator {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.target = { roll: 0, pitch: 0, yaw: 0, valid: false };
    this.current = { roll: 0, pitch: 0, yaw: 0 };
    this.pixelRatio = window.devicePixelRatio || 1;
    this.responseFactor = 0.34;

    this.resize();
    window.addEventListener("resize", () => this.resize());
    requestAnimationFrame(() => this.frame());
  }

  setTarget(attitude) {
    if (!attitude) {
      return;
    }

    this.target = {
      roll: Number(attitude.roll) || 0,
      pitch: Number(attitude.pitch) || 0,
      yaw: Number(attitude.yaw) || 0,
      valid: Boolean(attitude.valid),
    };
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(320, Math.floor(rect.height));
    this.pixelRatio = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(width * this.pixelRatio);
    this.canvas.height = Math.floor(height * this.pixelRatio);
    this.ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    this.width = width;
    this.height = height;
  }

  frame() {
    this.current.roll = this.smoothAngle(this.current.roll, this.target.roll, this.responseFactor);
    this.current.pitch += (this.target.pitch - this.current.pitch) * this.responseFactor;
    this.current.yaw = this.smoothAngle(this.current.yaw, this.target.yaw, this.responseFactor);
    this.draw();
    requestAnimationFrame(() => this.frame());
  }

  smoothAngle(current, target, factor) {
    let delta = ((target - current + 540) % 360) - 180;
    return current + delta * factor;
  }

  draw() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const cx = w / 2;
    const cy = h / 2 + 10;
    const radius = Math.min(w, h) * 0.42;

    ctx.clearRect(0, 0, w, h);
    this.drawPanelBackground(ctx, w, h);

    ctx.save();
    this.roundRectPath(ctx, cx - radius, cy - radius, radius * 2, radius * 2, 18);
    ctx.clip();
    this.drawHorizon(ctx, cx, cy, radius);
    this.drawPitchLadder(ctx, cx, cy, radius);
    ctx.restore();

    this.drawBezel(ctx, cx, cy, radius);
    this.drawRollScale(ctx, cx, cy, radius);
    this.drawAircraftSymbol(ctx, cx, cy, radius);
    this.drawStatus(ctx, w, h);
  }

  drawPanelBackground(ctx, w, h) {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, "#111820");
    gradient.addColorStop(1, "#090c10");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }

  drawHorizon(ctx, cx, cy, radius) {
    const pitchPixels = radius / 45;
    const pitchOffset = this.current.pitch * pitchPixels;
    const rollRad = (-this.current.roll * Math.PI) / 180;
    const span = radius * 3.8;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rollRad);
    ctx.translate(0, pitchOffset);

    ctx.fillStyle = "#188fe7";
    ctx.fillRect(-span, -span, span * 2, span);
    ctx.fillStyle = "#8a4a13";
    ctx.fillRect(-span, 0, span * 2, span);

    ctx.strokeStyle = "#f7fbff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-span, 0);
    ctx.lineTo(span, 0);
    ctx.stroke();

    ctx.restore();
  }

  drawPitchLadder(ctx, cx, cy, radius) {
    const pitchPixels = radius / 45;
    const rollRad = (-this.current.roll * Math.PI) / 180;
    const pitchOffset = this.current.pitch * pitchPixels;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rollRad);
    ctx.translate(0, pitchOffset);
    ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.lineWidth = 2;
    ctx.font = "600 15px Segoe UI, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (let pitch = -60; pitch <= 60; pitch += 5) {
      if (pitch === 0) {
        continue;
      }

      const y = -pitch * pitchPixels;
      if (Math.abs(y) > radius * 1.15) {
        continue;
      }

      const major = pitch % 10 === 0;
      const half = major ? radius * 0.22 : radius * 0.12;
      const gap = radius * 0.08;

      ctx.beginPath();
      ctx.moveTo(-gap - half, y);
      ctx.lineTo(-gap, y);
      ctx.moveTo(gap, y);
      ctx.lineTo(gap + half, y);
      ctx.stroke();

      if (major) {
        const label = String(Math.abs(pitch));
        ctx.fillText(label, -gap - half - 18, y);
        ctx.fillText(label, gap + half + 18, y);
      }
    }

    ctx.restore();
  }

  drawBezel(ctx, cx, cy, radius) {
    ctx.save();
    ctx.strokeStyle = "#263241";
    ctx.lineWidth = 10;
    this.roundRectPath(ctx, cx - radius, cy - radius, radius * 2, radius * 2, 18);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    this.roundRectPath(ctx, cx - radius + 5, cy - radius + 5, radius * 2 - 10, radius * 2 - 10, 14);
    ctx.stroke();
    ctx.restore();
  }

  drawRollScale(ctx, cx, cy, radius) {
    const top = cy - radius - 20;
    const tickAngles = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];

    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = "#eef6ff";
    ctx.fillStyle = "#eef6ff";
    ctx.lineWidth = 2;
    ctx.font = "600 13px Segoe UI, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (const angle of tickAngles) {
      const rad = (angle * Math.PI) / 180;
      const outer = radius + 10;
      const inner = radius - (angle % 30 === 0 || Math.abs(angle) === 45 ? 14 : 8);
      const x1 = Math.sin(rad) * outer;
      const y1 = -Math.cos(rad) * outer;
      const x2 = Math.sin(rad) * inner;
      const y2 = -Math.cos(rad) * inner;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      if (angle !== 0 && (Math.abs(angle) === 10 || Math.abs(angle) === 20 || Math.abs(angle) === 30 || Math.abs(angle) === 45 || Math.abs(angle) === 60)) {
        const lx = Math.sin(rad) * (radius - 33);
        const ly = -Math.cos(rad) * (radius - 33);
        ctx.fillText(String(Math.abs(angle)), lx, ly);
      }
    }

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(0, -radius - 2);
    ctx.lineTo(-9, -radius - 18);
    ctx.lineTo(9, -radius - 18);
    ctx.closePath();
    ctx.fill();

    ctx.rotate((this.current.roll * Math.PI) / 180);
    ctx.strokeStyle = "#2fbf8f";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -radius - 5);
    ctx.lineTo(0, -radius - 26);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "rgba(255,255,255,0.58)";
    ctx.font = "600 12px Segoe UI, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("ROLL", cx, top);
  }

  drawAircraftSymbol(ctx, cx, cy, radius) {
    const wing = radius * 0.34;
    const notch = radius * 0.08;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = "#ffffff";
    ctx.fillStyle = "#ffffff";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(-wing, 0);
    ctx.lineTo(-notch, 0);
    ctx.lineTo(0, -radius * 0.045);
    ctx.lineTo(notch, 0);
    ctx.lineTo(wing, 0);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.055, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-radius * 0.12, radius * 0.105);
    ctx.lineTo(0, radius * 0.07);
    ctx.lineTo(radius * 0.12, radius * 0.105);
    ctx.stroke();

    ctx.restore();
  }

  drawStatus(ctx, w, h) {
    if (this.target.valid) {
      return;
    }

    ctx.fillStyle = "rgba(8, 12, 16, 0.62)";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#97a4b3";
    ctx.font = "600 15px Segoe UI, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Waiting for IMU attitude", w / 2, h / 2);
  }

  roundRectPath(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }
}
