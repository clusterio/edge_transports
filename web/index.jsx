import { BaseWebPlugin } from "@clusterio/web_ui";
import { InputEdgeConfig } from "./components/InputEdgeConfig";

export class WebPlugin extends BaseWebPlugin {
	async init() {
		this.pages = [];
	}
	inputComponents = {
		edge_transports_internal: InputEdgeConfig,
	};
}
