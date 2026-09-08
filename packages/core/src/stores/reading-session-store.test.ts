import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ insertReadingSession: vi.fn() }));
vi.mock("../db/database", () => db);
const { useReadingSessionStore: store } = await import("./reading-session-store");

beforeEach(() => {
  vi.clearAllMocks();
  store.setState({ currentSession: null, sessionState: "STOPPED", stats: null });
});

it.each(["stop", "switch"])(
  "does not restore an old session after %s during autosave",
  async (action) => {
    let resolve!: () => void;
    db.insertReadingSession.mockReturnValue(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    store.getState().startSession("A");
    store.getState().updateActiveTime();
    const save = store.getState().saveCurrentSession();
    if (action === "stop") store.getState().stopSession();
    else store.getState().startSession("B");
    const live = store.getState().currentSession;
    resolve();
    await save;
    expect(store.getState().currentSession).toBe(live);
  },
);

it("preserves activity and pause state accumulated while saving", async () => {
  let resolve!: () => void;
  db.insertReadingSession.mockReturnValue(
    new Promise<void>((done) => {
      resolve = done;
    }),
  );
  store.getState().startSession("A");
  store.getState().updateActiveTime();
  store.getState().incrementPagesRead(2);
  store.getState().incrementCharactersRead(100);
  const save = store.getState().saveCurrentSession();
  store.getState().updateActiveTime();
  store.getState().incrementPagesRead(1);
  store.getState().incrementCharactersRead(50);
  store.getState().pauseSession();
  resolve();
  await save;
  expect(store.getState().currentSession).toMatchObject({
    bookId: "A",
    state: "PAUSED",
    totalActiveTime: 1000,
    pagesRead: 1,
    charactersRead: 50,
  });
});
