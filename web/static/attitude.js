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
    gradient.addColorStop(0, this.css("--attitude-shell-bg-start", "#111820"));
    gradient.addColorStop(1, this.css("--attitude-shell-bg-end", "#090c10"));
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
    ctx.strokeStyle = "#0b0d10";
    ctx.lineWidth = 10;
    this.roundRectPath(ctx, cx - radius, cy - radius, radius * 2, radius * 2, 18);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.24)";
    ctx.lineWidth = 1;
    this.roundRectPath(ctx, cx - radius + 5, cy - radius + 5, radius * 2 - 10, radius * 2 - 10, 14);
    ctx.stroke();
    ctx.restore();
  }

  drawRollScale(ctx, cx, cy, radius) {
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
      const outer = radius - 10;
      const inner = radius - (angle % 30 === 0 || Math.abs(angle) === 45 ? 34 : 27);
      const x1 = Math.sin(rad) * outer;
      const y1 = -Math.cos(rad) * outer;
      const x2 = Math.sin(rad) * inner;
      const y2 = -Math.cos(rad) * inner;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      if (angle !== 0 && (Math.abs(angle) === 10 || Math.abs(angle) === 20 || Math.abs(angle) === 30 || Math.abs(angle) === 45 || Math.abs(angle) === 60)) {
        const lx = Math.sin(rad) * (radius - 53);
        const ly = -Math.cos(rad) * (radius - 53);
        ctx.fillText(String(Math.abs(angle)), lx, ly);
      }
    }

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(0, -radius + 20);
    ctx.lineTo(-9, -radius + 4);
    ctx.lineTo(9, -radius + 4);
    ctx.closePath();
    ctx.fill();

    ctx.rotate((this.current.roll * Math.PI) / 180);
    ctx.strokeStyle = "#2fbf8f";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -radius + 28);
    ctx.lineTo(0, -radius + 6);
    ctx.stroke();
    ctx.restore();
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

    ctx.fillStyle = this.css("--attitude-status-overlay", "rgba(8, 12, 16, 0.62)");
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = this.css("--muted", "#97a4b3");
    ctx.font = "600 15px Segoe UI, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Waiting for IMU attitude", w / 2, h / 2);
  }

  css(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
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

class HeadingIndicator {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.target = { yaw: 0, valid: false };
    this.currentYaw = 0;
    this.pixelRatio = window.devicePixelRatio || 1;
    this.responseFactor = 0.28;

    this.resize();
    window.addEventListener("resize", () => this.resize());
    requestAnimationFrame(() => this.frame());
  }

  setTarget(attitude) {
    if (!attitude) {
      return;
    }

    this.target = {
      yaw: Number(attitude.yaw) || 0,
      valid: Boolean(attitude.valid),
    };
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(220, Math.floor(rect.width));
    const height = Math.max(220, Math.floor(rect.height || rect.width));
    this.pixelRatio = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(width * this.pixelRatio);
    this.canvas.height = Math.floor(height * this.pixelRatio);
    this.ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    this.width = width;
    this.height = height;
  }

  frame() {
    this.currentYaw = this.smoothAngle(this.currentYaw, this.target.yaw, this.responseFactor);
    this.draw();
    requestAnimationFrame(() => this.frame());
  }

  smoothAngle(current, target, factor) {
    const delta = ((target - current + 540) % 360) - 180;
    return current + delta * factor;
  }

  draw() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.405;

    ctx.clearRect(0, 0, w, h);
    this.drawPanel(ctx, w, h);
    this.drawCase(ctx, cx, cy, radius);
    this.drawCompassCard(ctx, cx, cy, radius);
    this.drawAircraft(ctx, cx, cy, radius);
    this.drawStatus(ctx, cx, cy, radius);
  }

  drawPanel(ctx, w, h) {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, "#d0cfcc");
    gradient.addColorStop(1, "#b8b8b6");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "#090909";
    ctx.lineWidth = 2;
    this.roundRectPath(ctx, 1, 1, w - 2, h - 2, 8);
    ctx.stroke();
  }

  drawCase(ctx, cx, cy, radius) {
    const outerRadius = radius + 14;
    const innerRadius = radius + 6;

    ctx.save();
    ctx.fillStyle = "#050505";
    ctx.beginPath();
    ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#f4f3ee";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2);
    ctx.stroke();

    const faceGradient = ctx.createRadialGradient(cx - radius * 0.25, cy - radius * 0.35, radius * 0.2, cx, cy, radius);
    faceGradient.addColorStop(0, "#4a4241");
    faceGradient.addColorStop(1, "#2f2a2a");
    ctx.fillStyle = faceGradient;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  drawCompassCard(ctx, cx, cy, radius) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.arc(0, 0, radius - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.rotate((-this.currentYaw * Math.PI) / 180);

    this.drawTicks(ctx, radius);
    this.drawCardLabels(ctx, radius);
    this.drawCardReferenceDots(ctx, radius);

    ctx.restore();
  }

  drawTicks(ctx, radius) {
    ctx.save();
    ctx.strokeStyle = "#fffefa";
    ctx.lineCap = "butt";

    for (let degree = 0; degree < 360; degree += 5) {
      const major = degree % 30 === 0;
      const medium = degree % 10 === 0;
      const outer = radius * 0.94;
      const inner = major ? radius * 0.76 : medium ? radius * 0.81 : radius * 0.86;

      ctx.save();
      ctx.rotate((degree * Math.PI) / 180);
      ctx.lineWidth = major ? 4 : medium ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(0, -outer);
      ctx.lineTo(0, -inner);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  drawCardLabels(ctx, radius) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.max(17, radius * 0.17)}px Segoe UI, Arial, sans-serif`;

    for (let degree = 0; degree < 360; degree += 30) {
      const label = this.headingLabel(degree);

      ctx.save();
      ctx.rotate((degree * Math.PI) / 180);
      ctx.translate(0, -radius * 0.68);
      ctx.fillStyle = this.headingLabelColor(degree);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }

    ctx.restore();
  }

  drawCardReferenceDots(ctx, radius) {
    ctx.save();
    ctx.fillStyle = "#fffefa";

    for (const degree of [45, 315]) {
      ctx.save();
      ctx.rotate((degree * Math.PI) / 180);
      ctx.beginPath();
      ctx.arc(0, -radius * 0.58, radius * 0.035, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  headingLabel(degree) {
    if (degree === 0) {
      return "N";
    }
    if (degree === 90) {
      return "E";
    }
    if (degree === 180) {
      return "S";
    }
    if (degree === 270) {
      return "W";
    }
    return String(degree / 10);
  }

  headingLabelColor(degree) {
    if (degree === 0) {
      return "#ff5a5f";
    }
    if (degree === 90) {
      return "#4ee08a";
    }
    if (degree === 180) {
      return "#54a7ff";
    }
    if (degree === 270) {
      return "#ffd447";
    }
    return "#fffefa";
  }

  drawAircraft(ctx, cx, cy, radius) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = "#fffefa";
    ctx.strokeStyle = "#fffefa";
    ctx.lineWidth = Math.max(3, radius * 0.032);
    ctx.lineCap = "square";

    ctx.beginPath();
    ctx.moveTo(0, -radius * 0.61);
    ctx.lineTo(-radius * 0.085, -radius * 0.42);
    ctx.lineTo(radius * 0.085, -radius * 0.42);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, -radius * 0.34);
    ctx.lineTo(0, -radius * 0.12);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, -radius * 0.24);
    ctx.lineTo(-radius * 0.44, -radius * 0.12);
    ctx.lineTo(-radius * 0.44, radius * 0.005);
    ctx.lineTo(-radius * 0.055, -radius * 0.005);
    ctx.lineTo(-radius * 0.075, radius * 0.18);
    ctx.lineTo(-radius * 0.185, radius * 0.22);
    ctx.lineTo(-radius * 0.185, radius * 0.29);
    ctx.lineTo(radius * 0.185, radius * 0.29);
    ctx.lineTo(radius * 0.185, radius * 0.22);
    ctx.lineTo(radius * 0.075, radius * 0.18);
    ctx.lineTo(radius * 0.055, -radius * 0.005);
    ctx.lineTo(radius * 0.44, radius * 0.005);
    ctx.lineTo(radius * 0.44, -radius * 0.12);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(-radius * 0.66, 0);
    ctx.lineTo(-radius * 0.51, 0);
    ctx.moveTo(radius * 0.51, 0);
    ctx.lineTo(radius * 0.66, 0);
    ctx.moveTo(0, radius * 0.38);
    ctx.lineTo(0, radius * 0.72);
    ctx.stroke();

    ctx.restore();
  }

  drawStatus(ctx, cx, cy, radius) {
    if (this.target.valid) {
      return;
    }

    ctx.save();
    ctx.fillStyle = "rgba(32, 32, 32, 0.62)";
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#deded9";
    ctx.font = "700 14px Segoe UI, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("No heading", cx, cy + radius * 0.54);
    ctx.restore();
  }

  roundRectPath(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
}
