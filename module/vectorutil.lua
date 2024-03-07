local vectorutil = {}

function vectorutil.vec2_sadd(a, s)
	return {a[1] + s, a[2] + s}
end

function vectorutil.vec2_add(a, b)
	return {a[1] + b[1], a[2] + b[2]}
end

function vectorutil.vec2_sub(a, b)
	return {a[1] - b[1], a[2] - b[2]}
end

function vectorutil.vec2_smul(a, s)
	return {a[1] * s, a[2] * s}
end

function vectorutil.vec2_mul(a, b)
	return {a[1] * b[1], a[2] * b[2]}
end

-- Rotate vector by entity direction, facing east means a clock wise rotation of 90 degrees.
function vectorutil.vec2_rot(a, dir)
	if dir == 0 then return a end
	if dir == 2 then return {-a[2], a[1]} end
	if dir == 4 then return {-a[1], -a[2]} end
	if dir == 6 then return {a[2], -a[1]} end
	error("Invalid direction " .. serpent.line(dir))
end

function vectorutil.dir_to_vec(dir)
	if dir == 0 then return {1, 0} end
	if dir == 2 then return {0, 1} end
	if dir == 4 then return {-1, 0} end
	if dir == 6 then return {0, -1} end
	error("Invalid direction " .. serpent.line(dir))
end

return vectorutil
