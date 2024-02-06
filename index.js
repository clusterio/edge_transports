"use strict";
const lib = require("@clusterio/lib");
const messages = require("./messages");

module.exports = {
	plugin: {
		name: "edge_transports",
		title: "Edge Transports",
		description:
			"Lets transport belts and pipes pass over the edge " +
			"from one server to another",
		instanceEntrypoint: "instance",
		controllerEntrypoint: "controller",

		instanceConfigFields: {
			"edge_transports.internal": {
				title: "Internal",
				type: "object",
				initialValue: { edges: [] },
			},
			"edge_transports.ticks_per_edge": {
				title: "Ticks Per Edge",
				description: "Number of game ticks to use processing each edge.",
				type: "number",
				initialValue: 15,
			},
			"edge_transports.transfer_message_rate": {
				title: "Transfer Message Rate",
				description: "Rate in messages per second to send edge transfers to other instances.",
				type: "number",
				initialValue: 50,
			},
			"edge_transports.transfer_command_rate": {
				title: "Transfer Command Rate",
				description: "Rate in commands per seccond to send edge transfer data into this instance.",
				type: "number",
				initialValue: 1000 / 34, // Factorio protocol update rate
			},
		},

		messages: [
			...Object.keys(messages).map(key => messages[key]),
		],
	},
};
