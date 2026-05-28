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

class RealtimeMultiLinePlot extends RealtimeLinePlot {
  constructor(canvas, options = {}) {
    super(canvas, {
      label: options.label || "telemetry",
      unit: options.unit || "",
      windowSeconds: options.windowSeconds,
      maxSamples: options.maxSamples,
    });
    this.series = options.series || [];
    this.visibleSeries = new Set(this.series.map((series) => series.key));
  }

  setSeriesVisible(key, visible) {
    if (visible) {
      this.visibleSeries.add(key);
    } else {
      this.visibleSeries.delete(key);
    }
    this.scheduleDraw();
  }

  visibleSeriesList() {
    return (this.series || []).filter((series) => this.visibleSeries.has(series.key));
  }

  addSample(timeSeconds, values) {
    if (!Number.isFinite(timeSeconds) || values === null || typeof values !== "object") {
      return;
    }

    const sample = { time: timeSeconds };
    let hasValue = false;
    for (const series of this.series) {
      const value = Number(values[series.key]);
      if (Number.isFinite(value)) {
        sample[series.key] = value;
        hasValue = true;
      }
    }

    if (!hasValue) {
      return;
    }

    const last = this.samples[this.samples.length - 1];
    if (last && Math.abs(last.time - timeSeconds) < 1e-6) {
      Object.assign(last, sample);
    } else {
      this.samples.push(sample);
    }

    if (this.samples.length > this.maxSamples) {
      this.samples.splice(0, this.samples.length - this.maxSamples);
    }

    const cutoff = timeSeconds - this.windowSeconds - 2;
    while (this.samples.length > 1 && this.samples[1].time < cutoff) {
      this.samples.shift();
    }

    this.scheduleDraw();
  }

  draw() {
    const ctx = this.ctx;
    const width = this.width || 240;
    const height = this.height || 140;
    const padding = { left: 48, right: 16, top: 12, bottom: 28 };
    const plotWidth = Math.max(1, width - padding.left - padding.right);
    const plotHeight = Math.max(1, height - padding.top - padding.bottom);
    const seriesList = this.visibleSeriesList();

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = this.css("--plot-bg", "rgba(8, 12, 16, 0.72)");
    this.roundRectPath(ctx, 0, 0, width, height, 6);
    ctx.fill();

    const latestTime = this.samples.length ? this.samples[this.samples.length - 1].time : this.windowSeconds;
    const xMax = Math.max(latestTime, this.windowSeconds);
    const xMin = xMax - this.windowSeconds;
    const visible = this.samples.filter((sample) => sample.time >= xMin && sample.time <= xMax);
    const range = this.valueRange(visible);
    const yMin = range.min;
    const yMax = range.max;

    this.drawGrid(ctx, padding, plotWidth, plotHeight, xMin, xMax, yMin, yMax);

    if (!visible.length || !seriesList.length) {
      this.drawEmpty(ctx, width, height);
      return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(padding.left, padding.top, plotWidth, plotHeight);
    ctx.clip();

    for (const series of seriesList) {
      ctx.strokeStyle = this.css(series.colorVar, series.color || this.fallbackColor);
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();

      let started = false;
      for (const sample of visible) {
        const value = Number(sample[series.key]);
        if (!Number.isFinite(value)) {
          started = false;
          continue;
        }

        const x = padding.left + ((sample.time - xMin) / (xMax - xMin)) * plotWidth;
        const y = padding.top + (1 - ((value - yMin) / (yMax - yMin))) * plotHeight;
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.stroke();
    }

    ctx.restore();
  }

  valueRange(samples) {
    let min = Infinity;
    let max = -Infinity;

    for (const sample of samples) {
      for (const series of this.visibleSeriesList()) {
        const value = Number(sample[series.key]);
        if (!Number.isFinite(value)) {
          continue;
        }

        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { min: -1, max: 1 };
    }

    const span = max - min;
    const pad = Math.max(span * 0.16, 0.5);
    return { min: min - pad, max: max + pad };
  }
}

class TrajectoryPlot extends RealtimeLinePlot {
  constructor(canvas, options = {}) {
    super(canvas, {
      label: options.label || "EKF",
      windowSeconds: options.windowSeconds || 0,
      maxSamples: options.maxSamples || 1600,
    });
  }

  addSample(timeSeconds, xValue, yValue) {
    const x = Number(xValue);
    const y = Number(yValue);
    if (!Number.isFinite(timeSeconds) || !Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }

    const last = this.samples[this.samples.length - 1];
    if (last && Math.abs(last.time - timeSeconds) < 1e-6) {
      last.x = x;
      last.y = y;
    } else {
      this.samples.push({ time: timeSeconds, x, y });
    }

    if (this.samples.length > this.maxSamples) {
      this.samples.splice(0, this.samples.length - this.maxSamples);
    }

    this.scheduleDraw();
  }

  draw() {
    const ctx = this.ctx;
    const width = this.width || 240;
    const height = this.height || 180;
    const padding = { left: 48, right: 18, top: 14, bottom: 34 };
    const plotWidth = Math.max(1, width - padding.left - padding.right);
    const plotHeight = Math.max(1, height - padding.top - padding.bottom);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = this.css("--plot-bg", "rgba(8, 12, 16, 0.72)");
    this.roundRectPath(ctx, 0, 0, width, height, 6);
    ctx.fill();

    if (!this.samples.length) {
      this.drawEmpty(ctx, width, height);
      return;
    }

    const range = this.positionRange();
    const xToCanvas = (value) => padding.left + ((value - range.xMin) / (range.xMax - range.xMin)) * plotWidth;
    const yToCanvas = (value) => padding.top + (1 - ((value - range.yMin) / (range.yMax - range.yMin))) * plotHeight;

    this.drawTrajectoryGrid(ctx, padding, plotWidth, plotHeight, range, xToCanvas, yToCanvas);

    ctx.save();
    ctx.beginPath();
    ctx.rect(padding.left, padding.top, plotWidth, plotHeight);
    ctx.clip();

    ctx.strokeStyle = this.css("--trajectory-line", "#2fbf8f");
    ctx.lineWidth = 2.2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    this.samples.forEach((sample, index) => {
      const x = xToCanvas(sample.x);
      const y = yToCanvas(sample.y);
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

    const first = this.samples[0];
    const latest = this.samples[this.samples.length - 1];
    this.drawPoint(ctx, xToCanvas(first.x), yToCanvas(first.y), this.css("--trajectory-start", "#ffd166"), 4);
    this.drawPoint(ctx, xToCanvas(latest.x), yToCanvas(latest.y), this.css("--trajectory-current", "#42a5ff"), 5);
    ctx.restore();
  }

  positionRange() {
    let xMin = this.samples[0].x;
    let xMax = this.samples[0].x;
    let yMin = this.samples[0].y;
    let yMax = this.samples[0].y;

    for (const sample of this.samples) {
      xMin = Math.min(xMin, sample.x);
      xMax = Math.max(xMax, sample.x);
      yMin = Math.min(yMin, sample.y);
      yMax = Math.max(yMax, sample.y);
    }

    const xCenter = (xMin + xMax) / 2;
    const yCenter = (yMin + yMax) / 2;
    const xSpan = Math.max(xMax - xMin, 2);
    const ySpan = Math.max(yMax - yMin, 2);
    const paddedXSpan = xSpan * 1.18;
    const paddedYSpan = ySpan * 1.18;

    return {
      xMin: xCenter - paddedXSpan / 2,
      xMax: xCenter + paddedXSpan / 2,
      yMin: yCenter - paddedYSpan / 2,
      yMax: yCenter + paddedYSpan / 2,
    };
  }

  drawTrajectoryGrid(ctx, padding, plotWidth, plotHeight, range, xToCanvas, yToCanvas) {
    const gridColor = this.css("--plot-grid", "rgba(151, 164, 179, 0.18)");
    const axisColor = this.css("--plot-axis", "rgba(151, 164, 179, 0.42)");
    const zeroColor = this.css("--plot-zero", "rgba(47, 191, 143, 0.42)");
    const textColor = this.css("--muted", "#97a4b3");

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

    for (let index = 0; index <= 6; index += 1) {
      const y = padding.top + (index / 6) * plotHeight;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + plotWidth, y);
      ctx.stroke();
    }

    if (range.xMin < 0 && range.xMax > 0) {
      const x = xToCanvas(0);
      ctx.strokeStyle = zeroColor;
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, padding.top + plotHeight);
      ctx.stroke();
    }

    if (range.yMin < 0 && range.yMax > 0) {
      const y = yToCanvas(0);
      ctx.strokeStyle = zeroColor;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + plotWidth, y);
      ctx.stroke();
    }

    ctx.strokeStyle = axisColor;
    ctx.strokeRect(padding.left, padding.top, plotWidth, plotHeight);

    ctx.fillStyle = textColor;
    ctx.font = "600 11px Segoe UI, Arial, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(this.formatAxis(range.yMax), padding.left - 8, padding.top + 2);
    ctx.fillText(this.formatAxis((range.yMin + range.yMax) / 2), padding.left - 8, padding.top + plotHeight / 2);
    ctx.fillText(this.formatAxis(range.yMin), padding.left - 8, padding.top + plotHeight - 2);

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("X / N", padding.left + plotWidth / 2, padding.top + plotHeight + 13);
    ctx.textAlign = "left";
    ctx.fillText(this.formatAxis(range.xMin), padding.left, padding.top + plotHeight + 13);
    ctx.textAlign = "right";
    ctx.fillText(this.formatAxis(range.xMax), padding.left + plotWidth, padding.top + plotHeight + 13);
    ctx.restore();
  }

  drawPoint(ctx, x, y, color, radius) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}
