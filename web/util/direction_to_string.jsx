export const directions = [
	"East",
	"South-east",
	"South",
	"South-west",
	"West",
	"North-west",
	"North",
	"North-east",
];

export function direction_to_string(direction) {
	if (direction === undefined) {
		return "";
	}
	if (typeof direction !== "number" || direction < 0 || direction >= 8) {
		return "unknown";
	}
	return directions[direction % 8];
};
