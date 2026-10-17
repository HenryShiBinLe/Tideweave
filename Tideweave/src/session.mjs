import { initialState, act, evaluate } from "./engine.mjs";
import { cleanState, recordAttempt } from "./progress.mjs";
class GameSession {
  constructor(level, progress) {
    this.level = level;
    this.progress = progress;
    this.state = cleanState(level, progress.records[level.id]?.state);
    this.history = [];
    this.future = [];
    this.result = null;
  }
  change(kind, id, option) {
    const next = act(this.level, this.state, kind, id, option);
    if (JSON.stringify(next) === JSON.stringify(this.state)) return false;
    this.history.push(structuredClone(this.state));
    if (this.history.length > 300) this.history.shift();
    this.future = [];
    this.state = next;
    this.result = null;
    this.save();
    return true;
  }
  save() {
    const r = this.progress.records[this.level.id] ??= { passed: false, perfect: false, attempts: 0, hintUnlocked: false };
    r.state = structuredClone(this.state);
    r.revision = this.level.revision??1;
    this.progress.last = this.level.id;
  }
  reset() {
    this.history.push(structuredClone(this.state));
    this.future = [];
    this.state = initialState(this.level);
    this.result = null;
    this.save();
  }
  undo() {
    if (!this.history.length) return;
    this.future.push(this.state);
    this.state = this.history.pop();
    this.result = null;
    this.save();
  }
  redo() {
    if (!this.future.length) return;
    this.history.push(this.state);
    this.state = this.future.pop();
    this.result = null;
    this.save();
  }
  check() {
    return evaluate(this.level, this.state);
  }
  finish(result) {
    this.result = result;
    recordAttempt(this.progress, this.level, this.state, result);
    this.save();
  }
}
export {
  GameSession
};
