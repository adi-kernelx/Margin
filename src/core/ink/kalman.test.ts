import { describe, expect, it } from 'vitest';
import { StrokePredictor } from './kalman';

describe('StrokePredictor', () => {
    it('does not predict before receiving a sample', () => {
        expect(new StrokePredictor().predict()).toBeNull();
    });

    it('learns forward velocity without moving the committed samples', () => {
        const predictor = new StrokePredictor(0.01, 0.1);
        predictor.update({ x: 0, y: 2 }, 0);
        predictor.update({ x: 10, y: 2 }, 10);
        predictor.update({ x: 20, y: 2 }, 20);
        const prediction = predictor.predict(16)!;
        expect(prediction.x).toBeGreaterThan(20);
        expect(prediction.y).toBeCloseTo(2);
    });

    it('reset discards velocity from the previous stroke', () => {
        const predictor = new StrokePredictor();
        predictor.update({ x: 0, y: 0 }, 0);
        predictor.update({ x: 10, y: 0 }, 10);
        predictor.reset();
        predictor.update({ x: 3, y: 4 }, 20);
        expect(predictor.predict(16)).toEqual({ x: 3, y: 4 });
    });
});
