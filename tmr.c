/* SPEC'26 Level 1. Compile: gcc -std=c11 -Wall -Wextra -pedantic tmr.c -o tmr */
#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include <stdlib.h>

typedef struct {
    uint8_t path[3], expected, voted;
    int mismatch, correct, corrected_bits;
} Result;

static uint8_t compute(uint8_t input) {
    return input;
}

static uint8_t majority(uint8_t a, uint8_t b, uint8_t c) {
    return (uint8_t)((a & b) | (a & c) | (b & c));
}

static int bit_count(uint8_t value) {
    int count = 0;
    while (value) { count += value & 1u; value >>= 1; }
    return count;
}

static Result simulate(uint8_t input, uint8_t fa, uint8_t fb, uint8_t fc) {
    Result r = {0};
    /* Independent logical calculations; masks inject output-register faults. */
    r.path[0] = compute(input) ^ fa;
    r.path[1] = compute(input) ^ fb;
    r.path[2] = compute(input) ^ fc;
    r.voted = majority(r.path[0], r.path[1], r.path[2]);
    r.mismatch = r.path[0] != r.path[1] || r.path[1] != r.path[2];
    /* Expected is a test oracle, not knowledge available to real TMR hardware. */
    r.expected = compute(input);
    r.correct = r.voted == r.expected;
    if (r.correct) {
        for (int i = 0; i < 3; ++i)
            r.corrected_bits += bit_count(r.path[i] ^ r.expected);
    }
    return r;
}

static void binary(uint8_t value) {
    for (int bit = 7; bit >= 0; --bit) putchar((value >> bit) & 1u ? '1' : '0');
}

static int run_tests(void) {
    unsigned checks = 0, failures = 0;
    for (unsigned a = 0; a < 2; ++a)
        for (unsigned b = 0; b < 2; ++b)
            for (unsigned c = 0; c < 2; ++c) {
                ++checks;
                failures += majority(a, b, c) != (a + b + c >= 2);
            }
    for (unsigned input = 0; input < 256; ++input) {
        Result healthy = simulate(input, 0, 0, 0);
        ++checks;
        failures += !healthy.correct || healthy.mismatch;
        for (int path = 0; path < 3; ++path)
            for (int bit = 0; bit < 8; ++bit) {
                uint8_t masks[3] = {0};
                masks[path] = (uint8_t)(1u << bit);
                Result r = simulate(input, masks[0], masks[1], masks[2]);
                ++checks;
                failures += !r.correct || !r.mismatch || r.corrected_bits != 1;
            }
    }
    for (int path = 0; path < 3; ++path)
        for (unsigned mask = 0; mask < 256; ++mask) {
            uint8_t masks[3] = {0};
            masks[path] = (uint8_t)mask;
            ++checks;
            failures += !simulate(10, masks[0], masks[1], masks[2]).correct;
        }
    Result split = simulate(10, 1, 2, 0);
    Result wrong = simulate(10, 1, 1, 0);
    Result silent = simulate(10, 1, 1, 1);
    Result recovered = simulate(10, 0, 0, 0);
    checks += 4;
    failures += !split.correct;
    failures += wrong.correct || !wrong.mismatch;
    failures += silent.correct || silent.mismatch;
    failures += !recovered.correct || recovered.mismatch;
    printf("Checks: %u | Failures: %u\n", checks, failures);
    printf("Single-bit fault injections verified: 6144\n");
    return failures ? 1 : 0;
}

int main(int argc, char **argv) {
    if (argc == 6 && strcmp(argv[1], "--json") == 0) {
        unsigned long values[4];
        for (int i = 0; i < 4; ++i) {
            char *end;
            values[i] = strtoul(argv[i + 2], &end, 10);
            if (!argv[i + 2][0] || *end || values[i] > 255) return 2;
        }
        Result r = simulate((uint8_t)values[0], (uint8_t)values[1],
                            (uint8_t)values[2], (uint8_t)values[3]);
        printf("{\"paths\":[%u,%u,%u],\"expected\":%u,\"voted\":%u,"
               "\"mismatch\":%d,\"correct\":%d,\"corrected_bits\":%d}\n",
               (unsigned)r.path[0], (unsigned)r.path[1], (unsigned)r.path[2],
               (unsigned)r.expected, (unsigned)r.voted,
               r.mismatch, r.correct, r.corrected_bits);
        return 0;
    }
    const char *names[] = {
        "Healthy operation", "Single-bit flip in A", "Single-bit flip in B",
        "Single-bit flip in C", "Multiple bits in one path",
        "Different bits in two paths", "Same bit in two paths: wrong majority",
        "Identical corruption in all paths: silent failure",
        "Fault removed: normal operation returns"
    };
    const uint8_t faults[][3] = {
        {0,0,0}, {1,0,0}, {0,8,0}, {0,0,128}, {15,0,0},
        {1,2,0}, {1,1,0}, {1,1,1}, {0,0,0}
    };
    unsigned corrected_events = 0, corrected_bits = 0, wrong_outputs = 0;
    if (argc == 2 && strcmp(argv[1], "--test") == 0) return run_tests();
    if (argc != 1) { fprintf(stderr, "Usage: %s [--test]\n", argv[0]); return 2; }
    puts("TMR Level 1 | Input = 10 | Calculation = input (direct 8-bit data)");
    for (unsigned s = 0; s < sizeof faults / sizeof faults[0]; ++s) {
        Result r = simulate(10, faults[s][0], faults[s][1], faults[s][2]);
        printf("\n%u. %s\n", s + 1, names[s]);
        for (int p = 0; p < 3; ++p) {
            printf("  Path %c: ", 'A' + p); binary(r.path[p]);
            printf(" (%u)\n", (unsigned)r.path[p]);
        }
        printf("  Voted: "); binary(r.voted);
        printf(" (%u), expected: %u\n", (unsigned)r.voted, (unsigned)r.expected);
        printf("  Disagreement: %s | Oracle confirms correct: %s\n",
               r.mismatch ? "YES" : "NO", r.correct ? "YES" : "NO");
        corrected_events += r.mismatch && r.correct;
        corrected_bits += (unsigned)r.corrected_bits;
        wrong_outputs += !r.correct;
    }
    printf("\nOracle-verified corrected events: %u\n", corrected_events);
    printf("Oracle-verified corrected bit instances: %u\n", corrected_bits);
    printf("Incorrect outputs (deliberate limit cases): %u\n", wrong_outputs);
    return 0;
}
