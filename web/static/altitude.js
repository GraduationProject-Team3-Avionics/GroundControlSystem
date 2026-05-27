class AltitudeTape {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.target = { meters: 0, valid: false };
    this.currentMeters = 0;
    this.pixelRatio = window.devicePixelRatio || 1;
    this.responseFactor = 0.22;

    this.resize();
    window.addEventListener("resize", () => this.resize());
    requestAnimationFrame(() => this.frame());
  }

  setTarget(altitude) {
    if (!altitude) {
      this.target = { meters: 0, valid: false };
      return;
    }

    const meters = Number(altitude.meters);
    this.target = {
      meters: Number.isFinite(meters) ? meters : 0,
      valid: Boolean(altitude.valid),
    };
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(150, Math.floor(rect.width));
    const height = Math.max(180, Math.floor(rect.height));
    this.pixelRatio = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(width * this.pixelRatio);
    this.canvas.height = Math.floor(height * this.pixelRatio);
    this.ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    this.width = width;
    this.height = height;
  }

  frame() {
    if (this.target.valid) {
      this.currentMeters += (this.target.meters - this.currentMeters) * this.responseFactor;
    }

    this.draw();
    requestAnimationFrame(() => this.frame());
  }

  draw() {
    const ctx = this.ctx;
    const width = this.width || 150;
    const height = this.height || 180;
    const current = this.target.valid ? this.currentMeters : 0;
    const centerY = height / 2;
    const compact = height < 320;
    const verticalPadding = compact ? 10 : 18;
    const pixelsPerMeter = compact ? 8 : 15;
    const minorStep = 1;
    const majorStep = 5;
    const markerSpace = width >= 180 ? 74 : 48;
    const tickEnd = Math.max(88, width - markerSpace);
    const majorStart = Math.max(44, tickEnd - Math.min(82, width * 0.4));
    const minorStart = Math.min(tickEnd - 16, Math.max(majorStart + 24, tickEnd - 46));
    const labelX = majorStart - 10;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = this.css("--bg", "#101318");
    ctx.fillRect(0, 0, width, height);

    this.drawTicks(ctx, {
      current,
      centerY,
      height,
      verticalPadding,
      pixelsPerMeter,
      minorStep,
      majorStep,
      tickEnd,
      majorStart,
      minorStart,
      labelX,
    });

    this.drawMarker(ctx, {
      width,
      centerY,
      tickEnd,
      value: this.target.valid ? this.target.meters : null,
    });

  }

  drawTicks(ctx, layout) {
    const {
      current,
      centerY,
      height,
      verticalPadding,
      pixelsPerMeter,
      minorStep,
      majorStep,
      tickEnd,
      majorStart,
      minorStart,
      labelX,
    } = layout;
    const minAltitude = current - (centerY - verticalPadding) / pixelsPerMeter - minorStep;
    const maxAltitude = current + (height - centerY - verticalPadding) / pixelsPerMeter + minorStep;
    const firstTick = Math.floor(minAltitude / minorStep) * minorStep;
    const tickColor = this.css("--altitude-tick", "#58c7e8");
    const mutedTickColor = this.css("--altitude-tick-muted", "rgba(88, 199, 232, 0.38)");
    const labelColor = this.css("--text", "#eef3f8");

    ctx.save();
    ctx.lineCap = "square";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    for (let altitude = firstTick; altitude <= maxAltitude; altitude += minorStep) {
      const y = centerY - (altitude - current) * pixelsPerMeter;
      if (y < verticalPadding || y > height - verticalPadding) {
        continue;
      }

      const isMajor = Math.abs(altitude / majorStep - Math.round(altitude / majorStep)) < 1e-6;
      ctx.strokeStyle = isMajor ? tickColor : mutedTickColor;
      ctx.lineWidth = isMajor ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(isMajor ? majorStart : minorStart, y);
      ctx.lineTo(tickEnd, y);
      ctx.stroke();

      if (isMajor) {
        ctx.fillStyle = labelColor;
        ctx.font = "650 11px Segoe UI, Arial, sans-serif";
        ctx.fillText(String(Math.round(altitude)), labelX, y);
      }
    }

    ctx.strokeStyle = this.css("--altitude-tick-muted", "rgba(88, 199, 232, 0.38)");
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tickEnd, verticalPadding);
    ctx.lineTo(tickEnd, height - verticalPadding);
    ctx.stroke();
    ctx.restore();
  }

  drawMarker(ctx, layout) {
    const { width, centerY, tickEnd, value } = layout;
    const markerColor = this.css("--altitude-marker", "#126e8d");
    const markerStroke = this.css("--altitude-marker-stroke", "#06151d");
    const textColor = this.css("--altitude-marker-text", "#eaf8ff");
    const tipX = tickEnd + 8;
    const sideValue = width >= 180;
    const baseX = Math.min(width - (sideValue ? 48 : 10), tipX + 30);
    const textX = sideValue ? Math.min(width - 2, baseX + 8) : width / 2;

    ctx.save();
    ctx.strokeStyle = markerColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tickEnd - 48, centerY);
    ctx.lineTo(tipX, centerY);
    ctx.stroke();

    ctx.fillStyle = markerColor;
    ctx.strokeStyle = markerStroke;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(tipX, centerY);
    ctx.lineTo(baseX, centerY - 16);
    ctx.lineTo(baseX, centerY + 16);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = textColor;
    ctx.font = "750 13px Segoe UI, Arial, sans-serif";
    ctx.textAlign = sideValue ? "left" : "center";
    ctx.textBaseline = "middle";
    ctx.fillText(this.formatValue(value), textX, sideValue ? centerY : centerY + 42);
    ctx.restore();
  }

  formatValue(value) {
    if (value === null || !Number.isFinite(value)) {
      return "--- m";
    }

    const absolute = Math.abs(value);
    if (absolute >= 100) {
      return `${value.toFixed(0)} m`;
    }
    return `${value.toFixed(1)} m`;
  }

  css(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }
}
