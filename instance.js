"use strict";
const util = require("util");

const libPlugin = require("@clusterio/lib/plugin");
const libLuaTools = require("@clusterio/lib/lua_tools");

class InstancePlugin extends libPlugin.BaseInstancePlugin {
	async init() {
		if (!this.instance.config.get("factorio.enable_save_patching")) {
			throw new Error("edge_transports plugin requires save patching");
		}

		let internal = this.instance.config.get("edge_transports.internal");
		await this.updateInternal(internal, internal);

		this.instance.server.on("ipc-edge_transports:edge_link_update", data => {
			this.handleEdgeLinkUpdate(data).catch(err => console.error(
				"Error handling data in edge_transports:", err
			));
		});
	}

	async handleEdgeLinkUpdate(update) {
		console.log("udpate: ", update);

		let edge = this.edges.get(update.edge_id);
		if (!edge) {
			console.error(`edge_transports: Got update for unknown edge ${data.edge_id}`);
			return;
		}

		let result = await this.info.messages.edgeLinkUpdate.send(this.instance, {
			instance_id: edge.target_instance,
			type: update.type,
			edge_id: edge.target_edge,
			data: update.data,
		});

		console.log("got back ", result);
	}

	async edgeLinkUpdateRequestHandler(message) {
		let { type, edge_id, data } = message.data;
		console.log("edgeLinkUpdateHandler", message);
		let json = libLuaTools.escapeString(JSON.stringify({ type, edge_id, data }));
		let result = await this.instance.server.sendRcon(`/sc edge_transports.edge_link_update("${json}")`);
		console.log("cmd result ", result);
	}

	async updateInternal(internal, prev) {
		this.internal = internal;
		this.edges = new Map(this.internal["edges"].map(e => [e.id, e]));

		if (!util.isDeepStrictEqual(this.internal["edges"], prev["edges"])) {
			let json = libLuaTools.escapeString(JSON.stringify(this.internal["edges"]));
			await this.instance.server.sendRcon(`/sc edge_transports.set_edges("${json}")`, true);
		}
	}

	async onStart() {
		await this.updateInternal(this.internal, {});
	}

	async onInstanceConfigFieldChanged(group, field, prev) {
		if (group.name === "edge_transports" && field === "internal") {
			await this.updateInternal(group.get(field), prev);
		}
	}

	async onStop() {
	}
}

module.exports = {
	InstancePlugin,
};
