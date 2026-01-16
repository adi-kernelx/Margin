export class Mutex {
    private locked = false;
    private waiting: Array<(value: void | PromiseLike<void>) => void> = [];

    async lock() {
        if (this.locked) {
            await new Promise<void>(resolve => this.waiting.push(resolve));
        }
        this.locked = true;
    }

    unlock() {
        if (this.waiting.length > 0) {
            const resolve = this.waiting.shift();
            resolve?.();
        } else {
            this.locked = false;
        }
    }
}
