//#region extensions/matrix/subagent-hooks-api.ts
let matrixSubagentHooksPromise = null;
function loadMatrixSubagentHooksModule() {
	matrixSubagentHooksPromise ??= import("./subagent-hooks-dkPAF6Et.js");
	return matrixSubagentHooksPromise;
}
function registerMatrixSubagentHooks(api) {
	api.on("subagent_ended", async (event) => {
		const { handleMatrixSubagentEnded } = await loadMatrixSubagentHooksModule();
		await handleMatrixSubagentEnded(event);
	});
	api.on("subagent_delivery_target", async (event) => {
		const { handleMatrixSubagentDeliveryTarget } = await loadMatrixSubagentHooksModule();
		return handleMatrixSubagentDeliveryTarget(event);
	});
}
//#endregion
export { registerMatrixSubagentHooks };
