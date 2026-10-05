# Upstream issue draft: undefined shift in BitReader::ue()

Target: `phxinyang/qualcomm-iris-vaapi`, pinned commit
`f587b14e6b22955c7250a45ff5f43588bbce2114`, `src/codec/bitwriter.h`.
This is a draft; no issue has been published.

`BitReader::ue()` allows `zeros` to reach 32 and then evaluates
`(1u << zeros)`. On our 32-bit `unsigned int` targets that is undefined
behavior. The shared reader is used by HEVC slice-header parsing; a malformed
or damaged NAL can reach the branch. The bounded byte reader itself does not
read outside its buffer; no memory corruption has been demonstrated.

Minimal reproduction:

```cpp
#include "src/codec/bitwriter.h"
int main() {
    const uint8_t bytes[] = {0, 0, 0, 0, 0x80};
    BitReader reader(bytes, sizeof bytes, 0);
    (void)reader.ue();
}
```

Compile with `-std=c++20 -fsanitize=undefined -fno-sanitize-recover=undefined`.
The original implementation reports:

```text
runtime error: shift exponent 32 is too large for 32-bit type 'unsigned int'
```

Proposed change: reject the 32nd leading zero before incrementing `zeros`,
using `std::runtime_error` so the existing exception boundary can report a
failure. Keep the valid 31-zero boundary unchanged. Patch and regression:
[`0004-bound-shared-exp-golomb-reader.patch`](patches/0004-bound-shared-exp-golomb-reader.patch).

Tests cover ordinary round trips, the lowest/highest values with a 31-zero
prefix (`0x7fffffff`, `0xfffffffe`), 32/33/40/64-zero prefixes and all-zero or
empty buffers. The patch addresses the shared reader, including the HEVC path,
without claiming live HEVC validation. It does not change the reader's existing
zero-fill behavior for truncated suffixes, or harden unrelated writer methods.
