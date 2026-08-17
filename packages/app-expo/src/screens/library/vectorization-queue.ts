export class VectorizationQueue<Book extends { id: string }> {
  private queuedBooks: Book[] = [];
  private active: { book: Book; controller: AbortController } | null = null;

  get activeBookId(): string | null {
    return this.active?.book.id ?? null;
  }

  snapshot(): Book[] {
    return [...this.queuedBooks];
  }

  enqueue(book: Book): boolean {
    if (this.active?.book.id === book.id || this.queuedBooks.some((item) => item.id === book.id)) {
      return false;
    }
    this.queuedBooks.push(book);
    return true;
  }

  startNext(): { book: Book; signal: AbortSignal } | null {
    if (this.active) return null;
    const book = this.queuedBooks.shift();
    if (!book) return null;
    const controller = new AbortController();
    this.active = { book, controller };
    return { book, signal: controller.signal };
  }

  cancel(bookId: string): "active" | "queued" | "not-found" {
    if (this.active?.book.id === bookId) {
      this.active.controller.abort();
      return "active";
    }
    const nextQueue = this.queuedBooks.filter((book) => book.id !== bookId);
    if (nextQueue.length === this.queuedBooks.length) return "not-found";
    this.queuedBooks = nextQueue;
    return "queued";
  }

  finish(bookId: string): void {
    if (this.active?.book.id === bookId) this.active = null;
  }
}
