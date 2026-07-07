import { t as __exportAll } from "./rolldown-runtime-8H4AJuhK.js";
import { u as resolveMatrixRoomId } from "./send-CQoq0bfR.js";
import { n as withResolvedRuntimeMatrixClient } from "./client-bootstrap-B9WG3S-N.js";
//#region extensions/matrix/src/matrix/actions/client.ts
var client_exports = /* @__PURE__ */ __exportAll({
	withResolvedActionClient: () => withResolvedActionClient,
	withResolvedRoomAction: () => withResolvedRoomAction,
	withStartedActionClient: () => withStartedActionClient
});
async function withResolvedActionClient(opts, run, mode = "stop") {
	return await withResolvedRuntimeMatrixClient(opts, run, mode);
}
async function withStartedActionClient(opts, run) {
	return await withResolvedActionClient({
		...opts,
		readiness: "started"
	}, run, "persist");
}
async function withResolvedRoomAction(roomId, opts, run) {
	return await withResolvedActionClient(opts, async (client) => {
		return await run(client, await resolveMatrixRoomId(client, roomId));
	});
}
//#endregion
export { withStartedActionClient as i, withResolvedActionClient as n, withResolvedRoomAction as r, client_exports as t };
