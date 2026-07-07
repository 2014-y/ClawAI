import { sendDurableMessageBatch as sendDurableMessageBatch$1 } from "openclaw/plugin-sdk/channel-outbound";
import { transcribeFirstAudio as transcribeFirstAudio$1 } from "openclaw/plugin-sdk/media-runtime";
//#region extensions/matrix/src/matrix/monitor/preflight-audio.runtime.ts
async function transcribeFirstAudio(...args) {
	return await transcribeFirstAudio$1(...args);
}
async function sendDurableMessageBatch(...args) {
	return await sendDurableMessageBatch$1(...args);
}
//#endregion
export { sendDurableMessageBatch, transcribeFirstAudio };
