"use strict";
const util = require("util");

const libPlugin = require("@clusterio/lib/plugin");
const libLuaTools = require("@clusterio/lib/lua_tools");
const RateLimiter = require("@clusterio/lib/RateLimiter");


class InstancePlugin extends libPlugin.BaseInstancePlugin {
	async init() {
		if (!this.instance.config.get("factorio.enable_save_patching")) {
			throw new Error("edge_transports plugin requires save patching");
		}

		this.edgeData = new Map();

		let internal = this.instance.config.get("edge_transports.internal");
		await this.updateInternal(internal, internal);

		this.instance.server.on("ipc-edge_transports:edge_link_update", data => {
			this.handleEdgeLinkUpdate(data).catch(err => this.logger.error(
				`Error handling edge_link_update:\n${err.stack}`
			));
		});

		this.instance.server.on("ipc-edge_transports:transfer", data => {
			this.edgeTransferFromGame(data).catch(err => this.logger.error(
				`Error handling transfer:\n${err.stack}`
			));
		});
	}

	async handleEdgeLinkUpdate(update) {
		let edge = this.edges.get(update.edge_id);
		if (!edge) {
			this.logger.error(`Got update for unknown edge ${data.edge_id}`);
			return;
		}

		let result = await this.info.messages.edgeLinkUpdate.send(this.instance, {
			instance_id: edge.target_instance,
			type: update.type,
			edge_id: edge.target_edge,
			data: update.data,
		});
	}

	async edgeLinkUpdateEventHandler(message) {
		let { type, edge_id, data } = message.data;
		let json = libLuaTools.escapeString(JSON.stringify({ type, edge_id, data }));
		let result = await this.sendRcon(`/sc edge_transports.edge_link_update("${json}")`, true);
	}

	async updateInternal(internal, prev) {
		this.internal = internal;
		this.edges = new Map(this.internal["edges"].map(e => [e.id, e]));
		for (let edge of this.internal["edges"]) {
			if (!this.edgeData.has(edge.id)) {
				this.edgeData.set(edge.id, {
					pendingMessage: {
						beltTransfers: new Map(),
					},
					messageTransfer: new RateLimiter({
						maxRate: this.instance.config.get("edge_transports.transfer_message_rate"),
						action: () => this.edgeTransferSendMessage(edge.id).catch(err => this.logger.error(
							`Error sending transfer message:\n${err.stack}`
						)),
					}),
					pendingCommand: {
						beltTransfers: new Map(),
					},
					commandTransfer: new RateLimiter({
						maxRate: this.instance.config.get("edge_transports.transfer_command_rate"),
						action: () => this.edgeTransferSendCommand(edge.id).catch(err => this.logger.error(
							`Error sending transfer command:\n${err.stack}`
						)),
					}),
				});
			}
		}

		if (!util.isDeepStrictEqual(this.internal["edges"], prev["edges"])) {
			let json = libLuaTools.escapeString(JSON.stringify(this.internal["edges"]));
			await this.sendRcon(`/sc edge_transports.set_edges("${json}")`, true);
		}
	}

	async updateTicksPerEdge(value) {
		await this.sendRcon(`/sc global.edge_transports.ticks_per_edge = ${value}`);
	}

	async edgeTransferFromGame(data) {
		let edge = this.edges.get(data.edge_id);
		if (!edge) {
			let json = libLuaTools.escapeString(JSON.stringify(data));
			console.log("edge not found");
			return; // XXX LATER PROBLEM
		}

		let edgeData = this.edgeData.get(data.edge_id);
		let pendingBeltTransfers = edgeData.pendingMessage.beltTransfers;
		for (let beltTransfer of data.belt_transfers || []) {
			let pending = pendingBeltTransfers.get(beltTransfer.offset);
			if (!pending) {
				pending = { itemStacks: [] };
				pendingBeltTransfers.set(beltTransfer.offset, pending);
			}
			pending.itemStacks.push(...beltTransfer.item_stacks);
		}

		edgeData.messageTransfer.activate();
	}

	async edgeTransferSendMessage(edgeId) {
		let edge = this.edges.get(edgeId);
		if (!edge) {
			console.log("impossible edge not found!");
			return; // XXX LATER PROBLEM
		}

		let edgeData = this.edgeData.get(edgeId);
		let pendingBeltTransfers = edgeData.pendingMessage.beltTransfers;
		edgeData.pendingMessage.beltTransfers = new Map();

		let beltTransfers = [];
		for (let [offset, beltTransfer] of pendingBeltTransfers) {
			beltTransfers.push({
				offset,
				item_stacks: beltTransfer.itemStacks,
			});
		}

		try {
			await this.info.messages.edgeTransfer.send(this.instance, {
				instance_id: edge.target_instance,
				edge_id: edge.target_edge,
				belt_transfers: beltTransfers,
			});

		// We assume the transfer did not happen if an error occured.
		} catch (err) {
			throw err;
			// TODO return items
		}
	}

	async edgeTransferRequestHandler(message) {
		let { edge_id, belt_transfers } = message.data;
		let edge = this.edges.get(edge_id);
		if (!edge) {
			console.log("impossible the edge was not found!");
			return; // XXX later problem
		}

		let edgeData = this.edgeData.get(edge_id);
		let pendingBeltTransfers = edgeData.pendingCommand.beltTransfers;
		for (let beltTransfer of belt_transfers) {
			let pending = pendingBeltTransfers.get(beltTransfer.offset);
			if (!pending) {
				pending = { itemStacks: [] };
				pendingBeltTransfers.set(beltTransfer.offset, pending);
			}
			pending.itemStacks.push(...beltTransfer.item_stacks);
		}

		edgeData.commandTransfer.activate();
	}

	async edgeTransferSendCommand(edgeId) {
		let edge = this.edges.get(edgeId);
		if (!edge) {
			console.log("how can this happen");
			return; // XXX later problem,
		}

		let edgeData = this.edgeData.get(edgeId);
		let pendingBeltTransfers = edgeData.pendingCommand.beltTransfers;
		edgeData.pendingCommand.beltTransfers = new Map();

		let beltTransfers = [];
		for (let [offset, beltTransfer] of pendingBeltTransfers) {
			beltTransfers.push({
				offset,
				item_stacks: beltTransfer.itemStacks,
			});
		}

		let json = libLuaTools.escapeString(JSON.stringify({
			edge_id: edgeId,
			belt_transfers: beltTransfers,
		}));
		let result = await this.sendRcon(`/sc edge_transports.transfer("${json}")`, true);
	}

	async onStart() {
		await this.updateInternal(this.internal, {});
		await this.updateTicksPerEdge(this.instance.config.get("edge_transports.ticks_per_edge"));
	}

	async onInstanceConfigFieldChanged(group, field, prev) {
		if (group.name !== "edge_transports") {
			return;
		}

		let value = group.get(field);
		if (field === "internal") {
			await this.updateInternal(value, prev);

		} else if (field === "ticks_per_edge") {
			await this.updateTicksPerEdge(value);

		} else if (field === "transfer_message_rate") {
			for (let edgeData of this.edgeData.values()) {
				edgeData.messageTransfer.maxRate = value;
			}
		} else if (field === "transfer_command_rate") {
			for (let edgeData of this.edgeData.values()) {
				edgeData.commandTransfer.maxRate = value;
			}
		}
	}

	async onStop() {
		// TODO pause edge transfers and notify target instances to stop sending
		for (let edgeData of this.edgeData.values()) {
			edgeData.messageTransfer.cancel();
			edgeData.commandTransfer.cancel();
		}
	}

	onExit() {
		for (let edgeData of this.edgeData.values()) {
			edgeData.messageTransfer.cancel();
			edgeData.commandTransfer.cancel();
		}
	}
}

module.exports = {
	InstancePlugin,
};
