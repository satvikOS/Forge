/* ────────────────────────────────────────────────────────────────────────────
 * net_denied_interpose.c — a dyld interposer that makes ANY network syscall a
 * hard abort. Loaded via DYLD_INSERT_LIBRARIES it turns "the retrieval gate
 * makes no network calls" from a claim into a measurement: if the gate opens a
 * socket, resolves a name, or connects to anything at all, the process dies and
 * the run fails.
 *
 * This is the SACROSANCT 12.4 / 20.2 offline proof for the retrieval module:
 * every non-browser function must still work with network denied.
 *
 * macOS-specific (__DATA,__interpose). Used only by run_retrieval_tests.sh.
 * ──────────────────────────────────────────────────────────────────────────── */
#include <netdb.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/socket.h>
#include <sys/types.h>

static void deny(const char *what) {
  fprintf(stderr, "\n*** NETWORK DENIED: the gate called %s() ***\n", what);
  fflush(stderr);
  abort();
}

static int denied_socket(int a, int b, int c) {
  (void)a; (void)b; (void)c;
  deny("socket");
  return -1;
}

static int denied_connect(int a, const struct sockaddr *b, socklen_t c) {
  (void)a; (void)b; (void)c;
  deny("connect");
  return -1;
}

static int denied_getaddrinfo(const char *a, const char *b, const struct addrinfo *c,
                              struct addrinfo **d) {
  (void)a; (void)b; (void)c; (void)d;
  deny("getaddrinfo");
  return -1;
}

static struct hostent *denied_gethostbyname(const char *a) {
  (void)a;
  deny("gethostbyname");
  return NULL;
}

typedef struct {
  const void *replacement;
  const void *replacee;
} interpose_entry;

__attribute__((used)) static const interpose_entry kInterposers[]
    __attribute__((section("__DATA,__interpose"))) = {
        {(const void *)denied_socket, (const void *)socket},
        {(const void *)denied_connect, (const void *)connect},
        {(const void *)denied_getaddrinfo, (const void *)getaddrinfo},
        {(const void *)denied_gethostbyname, (const void *)gethostbyname},
};
