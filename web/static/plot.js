class RealtimeLinePlot {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.label = options.label || "";
    this.unit = options.unit || "";
    this.colorVar = options.colorVar || "";
    this.fallbackColor = options.color || "#2fbf8f";
    this.windowSeconds = options.windowSeconds || 30;
    this.maxSamples = options.maxSamples || 2400;
    this.samples = [];
    this.pendingDraw = false;
    this.pixelRatio = window.devicePixelRatio || 1;

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  addSample(timeSeconds, value) {
    if (!Number.isFinite(timeSeconds) || !Number.isFinite(value)) {
      return;
    }

    const last = this.samples[this.samples.length - 1];
    if (last && Math.abs(last.x - timeSeconds) < 1e-6) {
      last.y = value;
    } else {
      this.samples.push({ x: timeSeconds, y: value });
    }

    if (this.samples.length > this.maxSamples) {
      this.samples.splice(0, this.samples.length - this.maxSamples);
    }

    const cutoff = timeSeconds - this.windowSeconds - 2;
    while (this.samples.length > 1 && this.samples[1].x < cutoff) {
      this.samples.shift();
    }

    this.scheduleDraw();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(240, Math.floor(rect.width));
    const height = Math.max(140, Math.floor(rect.height));
    this.pixelRatio = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(width * this.pixelRatio);
    this.canvas.height = Math.floor(height * this.pixelRatio);
    this.ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    this.width = width;
    this.height = height;
    this.scheduleDraw();
  }

  scheduleDraw() {
    if (this.pendingDraw) {
      return;
    }

    this.pendingDraw = true;
    requestAnimationFrame(() => {
      this.pendingDraw = false;
      this.draw();
    });
  }

  draw() {
    const ctx = this.ctx;
    const width = this.width || 240;
    const height = this.height || 140;
    const padding = { left: 42, right: 14, top: 12, bottom: 28 };
    const plotWidth = Math.max(1, width - padding.left - padding.right);
    const plotHeight = Math.max(1, height - padding.top - padding.bottom);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = this.css("--plot-bg", "rgba(8, 12, 16, 0.72)");
    this.roundRectPath(ctx, 0, 0, width, height, 6);
    ctx.fill();

    const latestTime = this.samples.length ? this.samples[this.samples.length - 1].x : this.windowSeconds;
    const xMax = Math.max(latestTime, this.windowSeconds);
    const xMin = xMax - this.windowSeconds;
    const visible = this.samples.filter((sample) => sample.x >= xMin && sample.x <= xMax);
    const range = this.valueRange(visible);
    const yMin = range.min;
    const yMax = range.max;

    this.drawGrid(ctx, padding, plotWidth, plotHeight, xMin, xMax, yMin, yMax);

    if (!visible.length) {
      this.drawEmpty(ctx, width, height);
      return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(padding.left, padding.top, plotWidth, plotHeight);
    ctx.clip();

    ctx.strokeStyle = this.css(this.colorVar, this.fallbackColor);
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();

    visible.forEach((sample, index) => {
      const x = padding.left + ((sample.x - xMin) / (xMax - xMin)) * plotWidth;
      const y = padding.top + (1 - ((sample.y - yMin) / (yMax - yMin))) * plotHeight;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();
    ctx.restore();
  }

  valueRange(samples) {
    if (!samples.length) {
      return { min: -1, max: 1 };
    }

    let min = samples[0].y;
    let max = samples[0].y;
    for (const sample of samples) {
      min = Math.min(min, sample.y);
      max = Math.max(max, sample.y);
    }

    const span = max - min;
    const pad = Math.max(span * 0.16, 1);
    return { min: min - pad, max: max + pad };
  }

  drawGrid(ctx, padding, plotWidth, plotHeight, xMin, xMax, yMin, yMax) {
    const gridColor = this.css("--plot-grid", "rgba(151, 164, 179, 0.18)");
    const axisColor = this.css("--plot-axis", "rgba(151, 164, 179, 0.42)");
    const textColor = this.css("--muted", "#97a4b3");
    const zeroColor = this.css("--plot-zero", "rgba(47, 191, 143, 0.42)");

    ctx.save();
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;

    for (let index = 0; index <= 6; index += 1) {
      const x = padding.left + (index / 6) * plotWidth;
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, padding.top + plotHeight);
      ctx.stroke();
    }

    for (let index = 0; index <= 4; index += 1) {
      const y = padding.top + (index / 4) * plotHeight;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + plotWidth, y);
      ctx.stroke();
    }

    if (yMin < 0 && yMax > 0) {
      const zeroY = padding.top + (1 - ((0 - yMin) / (yMax - yMin))) * plotHeight;
      ctx.strokeStyle = zeroColor;
      ctx.beginPath();
      ctx.moveTo(padding.left, zeroY);
      ctx.lineTo(padding.left + plotWidth, zeroY);
      ctx.stroke();
    }

    ctx.strokeStyle = axisColor;
    ctx.strokeRect(padding.left, padding.top, plotWidth, plotHeight);

    ctx.fillStyle = textColor;
    ctx.font = "600 11px Segoe UI, Arial, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(this.formatAxis(yMax), padding.left - 8, padding.top + 2);
    ctx.fillText(this.formatAxis((yMin + yMax) / 2), padding.left - 8, padding.top + plotHeight / 2);
    ctx.fillText(this.formatAxis(yMin), padding.left - 8, padding.top + plotHeight - 2);

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(`${Math.round(xMin - xMax)}s`, padding.left, padding.top + plotHeight + 9);
    ctx.fillText("now", padding.left + plotWidth, padding.top + plotHeight + 9);
    ctx.restore();
  }

  drawEmpty(ctx, width, height) {
    ctx.fillStyle = this.css("--muted", "#97a4b3");
    ctx.font = "600 12px Segoe UI, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`Waiting for ${this.label}`, width / 2, height / 2);
  }

  formatAxis(value) {
    if (Math.abs(value) >= 100) {
      return value.toFixed(0);
    }
    if (Math.abs(value) >= 10) {
      return value.toFixed(1);
    }
    return value.toFixed(2);
  }

  css(name, fallback) {
    if (!name) {
      return fallback;
    }
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
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
