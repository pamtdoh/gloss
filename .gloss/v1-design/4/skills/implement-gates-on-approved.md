# Implementation is gated only by the approved/ directory

`reviewkit-implement` refuses to start unless
`.reviewkit/<review>/approved/` exists, reads its facts as the agreed
contract, and never modifies `.reviewkit/`. That directory check is the
sole gate between reviewing and building — there is no sign-off file,
status field, or workflow state machine.
