/* =============================================================================
   qa/tests/task.test.mjs — core/task.js 回归测试（node --test，零依赖）
   运行：node --test qa/tests/
   ========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEpoch, createTaskRunner, createScope } from '../../js/core/task.js';

/** 可控 rAF 调度器：手动 tick 驱动帧回调，便于断言「旧任务是否还会执行」 */
function fakeFrames() {
  let nextId = 1;
  const queue = new Map();
  return {
    requestFrame(fn) { const id = nextId++; queue.set(id, fn); return id; },
    cancelFrame(id) { queue.delete(id); },
    tick(times = 1) {
      for (let i = 0; i < times; i += 1) {
        const due = [...queue.values()];
        queue.clear();
        for (const fn of due) fn();
      }
    },
    get pending() { return queue.size; },
  };
}

test('createEpoch：只有最新 token 有效，invalidate 让旧 token 过期', () => {
  const epoch = createEpoch();
  const a = epoch.next();
  assert.equal(epoch.isCurrent(a), true);
  const b = epoch.next();
  assert.equal(epoch.isCurrent(a), false);
  assert.equal(epoch.isCurrent(b), true);
  epoch.invalidate();
  assert.equal(epoch.isCurrent(b), false);
});

test('createTaskRunner：分帧执行到完成，onDone 只调用一次', () => {
  const frames = fakeFrames();
  const runner = createTaskRunner(frames);
  const steps = [];
  let done = 0;
  runner.run(() => { steps.push(1); return steps.length < 3; }, () => { done += 1; });
  assert.equal(runner.running, true);
  assert.equal(steps.length, 0, 'run 不应同步执行 onStep');
  frames.tick(3);
  assert.equal(steps.length, 3);
  assert.equal(done, 1);
  assert.equal(runner.running, false);
  frames.tick(2);
  assert.equal(done, 1, '完成后不应再有回调');
});

test('createTaskRunner：run 会让上一次任务失效，旧任务不再推进/完成', () => {
  const frames = fakeFrames();
  const runner = createTaskRunner(frames);
  const a = [];
  const b = [];
  let aDone = 0;
  let bDone = 0;
  runner.run(() => { a.push(1); return true; }, () => { aDone += 1; });
  frames.tick(1);
  assert.equal(a.length, 1);
  runner.run(() => { b.push(1); return true; }, () => { bDone += 1; });
  frames.tick(3);
  assert.equal(a.length, 1, '被取代的旧任务不应继续执行 onStep');
  assert.equal(aDone, 0, '被取代的旧任务不应调用 onDone');
  assert.ok(b.length >= 1);
  assert.equal(bDone, 0, '新任务未完成前不应 onDone');
});

test('createTaskRunner：cancel 后停止分帧且不触发 onDone', () => {
  const frames = fakeFrames();
  const runner = createTaskRunner(frames);
  let done = 0;
  let calls = 0;
  runner.run(() => { calls += 1; return true; }, () => { done += 1; });
  frames.tick(1);
  runner.cancel();
  assert.equal(runner.running, false);
  frames.tick(3);
  assert.equal(calls, 1);
  assert.equal(done, 0);
  assert.equal(frames.pending, 0);
});

test('createTaskRunner：onStep 抛错走 onError，不继续分帧', () => {
  const frames = fakeFrames();
  const errors = [];
  const runner = createTaskRunner({ ...frames, onError: (e) => errors.push(e) });
  let done = 0;
  runner.run(() => { throw new Error('boom'); }, () => { done += 1; });
  frames.tick(2);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, 'boom');
  assert.equal(done, 0);
  assert.equal(runner.running, false);
  assert.equal(frames.pending, 0);
});

test('createScope：逆序释放、幂等、单个清理失败不影响其余', () => {
  const scope = createScope();
  const order = [];
  const origError = console.error;
  console.error = () => {};
  try {
    scope.add(() => order.push('a'));
    scope.add(() => { throw new Error('bad'); });
    scope.add(() => order.push('c'));
    scope.dispose();
    scope.dispose();
    assert.deepEqual(order, ['c', 'a']);
    assert.equal(scope.disposed, true);
    scope.add(() => order.push('late'));
    assert.deepEqual(order, ['c', 'a'], 'dispose 之后不再接受清理函数');
  } finally {
    console.error = origError;
  }
});
