"use strict";
const { libConfig, libLink } = require("@clusterio/lib");


class InstanceConfigGroup extends libConfig.PluginConfigGroup { }
InstanceConfigGroup.defaultAccess = ["master", "slave", "control"];
InstanceConfigGroup.groupName = "edge_transports";
InstanceConfigGroup.define({
	name: "internal",
	type: "object",
	initial_value: { edges: [] },
});
InstanceConfigGroup.define({
	name: "ticks_per_edge",
	title: "Ticks Per Edge",
	description: "Number of game ticks to use processing each edge.",
	type: "number",
	initial_value: 15,
});
InstanceConfigGroup.define({
	name: "transfer_message_rate",
	title: "Transfer Message Rate",
	description: "Rate in messages per second to send edge transfers to other instances.",
	type: "number",
	initial_value: 50,
});
InstanceConfigGroup.define({
	name: "transfer_command_rate",
	title: "Transfer Command Rate",
	description: "Rate in commands per seccond to send edge transfer data into this instance.",
	type: "number",
	initial_value: 1000 / 34, // Factorio protocol update rate
});
InstanceConfigGroup.finalize();

let instanceToInstance = ["instance-slave", "slave-master", "master-slave", "slave-instance"];

module.exports = {
	name: "edge_transports",
	title: "Edge Transports",
	description:
		"Lets transport belts and pipes pass over the edge "+
		"from one server to another",
	instanceEntrypoint: "instance",
	masterEntrypoint: "master",

	InstanceConfigGroup,

	messages: {
		activateEdgesAfterInternalUpdate: new libLink.Event({
			type: "edge_transports:activate_edges_after_internal_update",
			links: ["instance-slave", "slave-master"],
			forwardTo: "master",
			eventProperties: {
				"instance_id": { type: "integer" },
			},
		}),
		ensureEdgesDeactivated: new libLink.Request({
			type: "edge_transports:ensure_edges_deactivated",
			links: ["instance-slave", "slave-master"],
			forwardTo: "master",
			requestProperties: {
				"instance_id": { type: "integer" },
			},
		}),
		setActiveEdges: new libLink.Request({
			type: "edge_transports:set_active_edges",
			links: ["master-slave", "slave-instance"],
			forwardTo: "instance",
			requestProperties: {
				"active_edges": {
					type: "array",
					items: { type: "integer" },
				},
			},
		}),
		edgeLinkUpdate: new libLink.Event({
			type: "edge_transports:edge_link_update",
			links: instanceToInstance,
			forwardTo: "instance",
			eventProperties: {
				"edge_id": { type: "integer" },
				"type": { type: "string" },
				"data": { type: "object" },
			},
		}),
		edgeTransfer: new libLink.Request({
			type: "edge_transports:edge_transfer",
			links: instanceToInstance,
			forwardTo: "instance",
			requestProperties: {
				"edge_id": { type: "integer" },
				"belt_transfers": {
					type: "array",
					items: {
						type: "object",
						additionalProperties: false,
						required: ["offset"],
						properties: {
							"offset": { type: "number" },
							"item_stacks": {
								type: "array",
								items: { type: "object" },
							},
							"set_flow": { type: "boolean" },
						},
					},
				},
			},
		}),
	},
};
