import type { Point2D } from './geometry';

interface AxisState {
    position: number;
    velocity: number;
    positionVariance: number;
    velocityVariance: number;
}

/** A small constant-velocity Kalman filter used only for the disposable live preview. */
export class StrokePredictor {
    private x: AxisState | null = null;
    private y: AxisState | null = null;
    private lastTimestamp = 0;
    private samples = 0;
    private readonly processNoise: number;
    private readonly measurementNoise: number;

    constructor(
        processNoise = 0.01,
        measurementNoise = 0.8,
    ) {
        this.processNoise = processNoise;
        this.measurementNoise = measurementNoise;
    }

    reset(): void {
        this.x = null;
        this.y = null;
        this.lastTimestamp = 0;
        this.samples = 0;
    }

    update(point: Point2D, timestamp: number): Point2D {
        if (!this.x || !this.y) {
            this.x = this.makeAxis(point.x);
            this.y = this.makeAxis(point.y);
            this.lastTimestamp = timestamp;
            this.samples = 1;
            return point;
        }
        const dt = Math.max(0.001, Math.min(0.05, (timestamp - this.lastTimestamp) / 1000));
        this.lastTimestamp = timestamp;
        if (this.samples === 1) {
            this.x.velocity = (point.x - this.x.position) / dt;
            this.y.velocity = (point.y - this.y.position) / dt;
            this.x.position = point.x;
            this.y.position = point.y;
            this.samples = 2;
            return point;
        }
        this.x = this.updateAxis(this.x, point.x, dt);
        this.y = this.updateAxis(this.y, point.y, dt);
        this.samples += 1;
        return { x: this.x.position, y: this.y.position };
    }

    predict(aheadMs = 16): Point2D | null {
        if (!this.x || !this.y) return null;
        const dt = Math.max(0, Math.min(32, aheadMs)) / 1000;
        return {
            x: this.x.position + this.x.velocity * dt,
            y: this.y.position + this.y.velocity * dt,
        };
    }

    private makeAxis(position: number): AxisState {
        return { position, velocity: 0, positionVariance: 1, velocityVariance: 10 };
    }

    private updateAxis(state: AxisState, measurement: number, dt: number): AxisState {
        const predictedPosition = state.position + state.velocity * dt;
        const positionVariance = state.positionVariance + dt * dt * state.velocityVariance + this.processNoise;
        const gain = positionVariance / (positionVariance + this.measurementNoise);
        const residual = measurement - predictedPosition;
        const position = predictedPosition + gain * residual;
        const velocityGain = Math.min(1 / dt, state.velocityVariance * dt / (positionVariance + this.measurementNoise));
        return {
            position,
            velocity: state.velocity + velocityGain * residual,
            positionVariance: (1 - gain) * positionVariance,
            velocityVariance: Math.max(this.processNoise, (1 - gain * dt) * state.velocityVariance),
        };
    }
}
