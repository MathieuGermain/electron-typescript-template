import { onePlusOne } from '../src/index';

describe('Test method onePlusOne', () => {
    it('should be 2', () => {
        const result = onePlusOne();
        expect(result).toBe(2);
    });
});
