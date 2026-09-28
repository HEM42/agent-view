// THROWAWAY feasibility probe — replaced in Task 4.
const out = document.getElementById("out") as HTMLPreElement;
const handler = (globalThis as any).webkit?.messageHandlers?.herdr;

async function probe(): Promise<void> {
  if (!handler) {
    out.textContent = "no bridge (preview or plain browser)";
    return;
  }
  try {
    const reply = await handler.postMessage({ cmd: "list" });
    out.textContent = JSON.stringify(reply, null, 2);
  } catch (e) {
    out.textContent = `bridge error: ${String(e)}`;
  }
}

void probe();
setInterval(probe, 2000);
