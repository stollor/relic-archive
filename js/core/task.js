/* =============================================================================
   遗迹2 · 遗物档案 — core/task.js
   轻量异步任务生命周期工具（无依赖、无 DOM，可在 node --test 下直接引用）：
     createEpoch()      单调递增代际：异步回调落地前判定「我是否还是最新一次」。
     createTaskRunner() 分帧任务（requestAnimationFrame）版本控制：run() 自动让上一次任务失效，
                        cancel() 停止分帧；过期任务不会再调用 onStep / onDone。
     createScope()      清理函数收集器：off / clearTimeout / disconnect / removeEventListener 一起释放。
   用途：路由派发防旧页面后挂载、实验室分帧穷举防旧结果覆盖新条件、组件销毁后不再产生界面更新。
   ========================================================================== */

const hasRaf = typeof requestAnimationFrame === 'function';
const defaultFrame = hasRaf ? (fn) => requestAnimationFrame(fn) : (fn) => setTimeout(fn, 16);
const defaultCancel = hasRaf ? (id) => cancelAnimationFrame(id) : (id) => clearTimeout(id);

/** 单调递增代际：每次 next() / invalidate() 都让先前拿到的 token 过期 */
export function createEpoch() {
  let n = 0;
  return {
    /** 开始新的一代，返回本代 token（传给 isCurrent 判定） */
    next() { n += 1; return n; },
    current() { return n; },
    isCurrent(token) { return token === n; },
    /** 只让现有 token 失效，不返回新 token */
    invalidate() { n += 1; return n; },
  };
}

/**
 * 分帧任务器：同一时刻只允许一个有效任务。
 *   run(onStep, onDone)  onStep() 返回 true=还要下一帧；返回 false=完成（随后同步调用 onDone）
 *   cancel()             停止分帧并让当前任务失效（onDone 不会执行）
 *   running              是否有有效任务在跑
 * 注意：run() 会**先**让上一次任务失效再启动，因此「条件变了就重算」无需自己维护 state.running。
 */
export function createTaskRunner({
  requestFrame = defaultFrame,
  cancelFrame = defaultCancel,
  onError = null,
} = {}) {
  const doCancel = cancelFrame;
  let version = 0;
  let frameId = 0;
  let running = false;

  function stopFrame() {
    if (frameId) {
      try { doCancel(frameId); } catch { /* 已结束的帧号忽略 */ }
      frameId = 0;
    }
  }

  return {
    get running() { return running; },

    run(onStep, onDone) {
      stopFrame();
      version += 1;
      const mine = version;
      running = true;
      const tick = () => {
        frameId = 0;
        if (mine !== version) return;
        let more;
        try {
          more = onStep();
        } catch (err) {
          if (mine === version) { running = false; version += 1; }
          if (onError) onError(err);
          else console.error('[task]', err);
          return;
        }
        if (mine !== version) return;
        if (more) { frameId = requestFrame(tick); return; }
        running = false;
        if (onDone) onDone();
      };
      frameId = requestFrame(tick);
      return mine;
    },

    cancel() {
      version += 1;
      stopFrame();
      running = false;
    },
  };
}

/**
 * 合并刷新：同一帧内多次 schedule() 只执行一次 fn()，cancel() 取消挂起的帧。
 * 适合「状态变了就重渲染」的廉价同步渲染；销毁时务必 cancel()。
 * @param {Function} fn 实际刷新函数
 * @returns {{schedule:Function, cancel:Function, pending:boolean, flush:Function}}
 */
export function createRefresh(fn, { requestFrame = defaultFrame, cancelFrame = defaultCancel } = {}) {
  let frameId = 0;
  const run = () => {
    frameId = 0;
    fn();
  };
  return {
    schedule() {
      if (frameId) return;
      frameId = requestFrame(run);
    },
    cancel() {
      if (!frameId) return;
      try { cancelFrame(frameId); } catch { /* 已结束的帧号忽略 */ }
      frameId = 0;
    },
    /** 立即执行挂起的刷新（无挂起则什么都不做） */
    flush() {
      if (!frameId) return;
      try { cancelFrame(frameId); } catch { /* 已结束的帧号忽略 */ }
      frameId = 0;
      fn();
    },
    get pending() { return !!frameId; },
  };
}

/** 清理函数收集器：dispose() 幂等，逆序执行，单个失败不阻断其余清理 */
export function createScope() {
  const fns = [];
  let disposed = false;
  return {
    get disposed() { return disposed; },
    add(fn) { if (typeof fn === 'function' && !disposed) fns.push(fn); return fn; },
    dispose() {
      if (disposed) return;
      disposed = true;
      while (fns.length) {
        const fn = fns.pop();
        try { fn(); } catch (err) { console.error('[scope]', err); }
      }
    },
  };
}

export default { createEpoch, createTaskRunner, createRefresh, createScope };
