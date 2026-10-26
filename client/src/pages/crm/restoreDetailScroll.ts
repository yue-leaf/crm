/** Wait for asynchronous lists, and never fight deliberate user input. */
export function restoreDetailScroll(body: HTMLElement, top: number): () => void {
  let frame: number = 0;
  let stopped: boolean = false;
  const stop = () => {
    if (stopped) return;
    stopped = true; cancelAnimationFrame(frame); clearTimeout(timer);
    observer.disconnect(); resize.disconnect();
    for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) body.removeEventListener(event, stop);
  };
  const attempt = () => {
    if (stopped) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (body.querySelector('[data-page-loading="true"]')) return;
      body.scrollTop = Math.min(top, Math.max(0, body.scrollHeight - body.clientHeight));
      stop();
    });
  };
  const observer: MutationObserver = new MutationObserver(attempt);
  const resize: ResizeObserver = new ResizeObserver(attempt);
  const timer: ReturnType<typeof setTimeout> = setTimeout(stop, 60000);
  observer.observe(body, { childList: true, subtree: true, attributes: true });
  resize.observe(body);
  for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) body.addEventListener(event, stop, { passive: true });
  attempt();
  return stop;
}
