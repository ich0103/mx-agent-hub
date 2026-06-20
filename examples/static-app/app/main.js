document.getElementById("notify")?.addEventListener("click", () => {
  window.parent?.postMessage(
    {
      source: "mx-agent-hub-demo",
      type: "demo.clicked",
      payload: {
        clickedAt: new Date().toISOString(),
      },
    },
    "*",
  );
});
