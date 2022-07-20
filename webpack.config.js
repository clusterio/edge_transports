"use strict";
const path = require("path");
const webpack = require("webpack");
const { merge } = require("webpack-merge");

const common = require("@clusterio/web_ui/webpack.common");

module.exports = (env = {}) => merge(common(env), {
	context: __dirname,
	entry: "./web/index.jsx",
	output: {
		path: path.resolve(__dirname, "dist", "web"),
	},
	plugins: [
		new webpack.container.ModuleFederationPlugin({
			name: "edge_transports",
			library: { type: "var", name: "plugin_edge_transports" },
			exposes: {
				"./info": "./info.js",
				"./package.json": "./package.json",
			},
			shared: {
				"@clusterio/lib": { import: false },
				"@clusterio/web_ui": { import: false },
				"antd": { import: false },
				"react": { import: false },
				"react-dom": { import: false },
			},
		}),
	],
});
