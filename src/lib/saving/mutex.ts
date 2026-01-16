
export class Mutex {
    private locked = false;

    async lock(): Promise<void> {
        while (this.locked) {
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        this.locked = true;
    }

    unlock(): void {
        this.locked = false;
    }
}
