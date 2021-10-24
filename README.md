Edge Transports
===============

Clusterio plugin implementing item and fluid transfer between servers by
letting them pass "over the edge" from one server to another.

Installation
----------------------

In the folder of each of your clusterio installs, run the following:

    npm install @clusterio/plugin-edge_transports
    npx clusteriomaster plugin add @clusterio/plugin-edge_transports

Instance Configuration
----------------------

### edge_transports.internal

Holds the definitions for the edges on this instance and where they go
to.  This is an internal data structure with no type checking or
safeguards, modify with caution.

Example value:
```json
{
    "edges": [
        {
            "id": 1,
            "origin": [10, -10],
            "surface": 1,
            "direction": 2,
            "length": 20,
            "target_instance": 324,
            "target_edge": 1
        }
    ]
}
```

Edges are defined as originating from an `origin` point in the game
world and going out in `direction` for `length` number of tiles, where
the right side is considered part of the world and the left side is over
the edge.  The valid direction values are north=6, east=0, south=2, and
west=4.  The other side of the edge is defined by `target_instance` and
`target_edge`.

Defaults to `{"edges":[]}`.


### edge_transports.ticks_per_edge

The number of in-game ticks to spend processing each edge in the world.
A lower values means less latency for items and fluid crossing the edge
but more work to do each tick.  A value in the order of 60 / number of
edges on the instance is a decent compromise between latency and work
done.

Defaults to `15`.


### edge_transports.transfer_message_rate

Maximum rate in messages per second to send data of items and fluids
transported over edges to other instances at.  Transfers of items and
fluids sent from the game exceeding this rate will be delayed and
bunched together, increasing latency and decreasing operational
overhead.  Note that this limit applies per edge.

Defaults to `50`.


### edge_transports.transfer_command_rate

Maximum rate in commands per second to send data of items and fluids
transported into this instance.  Transfers exceeding this rate will be
delayed and bunched together, increasing latency and decreasing
operational overhead.  Note that this limit applies per edge.

Defaults to one command every 34ms or a little under 30.
