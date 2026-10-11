import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadFile, isPrivateAddress, RemoteFileError } from "@/infra/remoteFile";

afterEach(() => vi.unstubAllGlobals());

const PUBLIC = "https://93.184.216.34/precos.csv"; // IP público literal: não depende de DNS

describe("isPrivateAddress", () => {
  it("flags internal, loopback, link-local and metadata addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it("lets public addresses through", () => {
    for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:2800:220:1:248:1893:25c8:1946"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});

describe("downloadFile", () => {
  it("refuses http, localhost and private addresses before any request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const url of ["http://93.184.216.34/a.csv", "https://localhost/a.csv", "https://127.0.0.1/a.csv", "https://10.0.0.5/a.csv", "https://[::1]/a.csv", "https://servidor.internal/a.csv"]) {
      await expect(downloadFile(url, { maxBytes: 1000 }), url).rejects.toThrow(RemoteFileError);
    }
    await expect(downloadFile("não é url", { maxBytes: 1000 })).rejects.toThrow(RemoteFileError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("downloads, names the file from the response and sends the auth header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("a;b\n1;2", { headers: { "content-disposition": 'attachment; filename="lista%20nova.csv"' } }));
    vi.stubGlobal("fetch", fetchMock);
    const file = await downloadFile(PUBLIC, { maxBytes: 1000, headers: { Authorization: "Bearer x" } });
    expect(file.buffer.toString()).toBe("a;b\n1;2");
    expect(file.fileName).toBe("lista nova.csv");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer x");
  });

  it("follows a redirect to another public host without forwarding credentials, and blocks redirects to private hosts", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://8.8.8.8/real.csv" } }))
      .mockResolvedValueOnce(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    await downloadFile(PUBLIC, { maxBytes: 1000, headers: { Authorization: "Bearer x" } });
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBeUndefined();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } })));
    await expect(downloadFile(PUBLIC, { maxBytes: 1000 })).rejects.toThrow(RemoteFileError);
  });

  it("enforces the size limit, and translates auth and server errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x".repeat(2000))));
    await expect(downloadFile(PUBLIC, { maxBytes: 1000 })).rejects.toThrow(/grande demais/);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 403 })));
    await expect(downloadFile(PUBLIC, { maxBytes: 1000 })).rejects.toThrow(/recusou o acesso/);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));
    await expect(downloadFile(PUBLIC, { maxBytes: 1000 })).rejects.toThrow(/erro 500/);
  });

  it("reports unreachable hosts without leaking details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND secret-internal-name")));
    await expect(downloadFile(PUBLIC, { maxBytes: 1000 })).rejects.toThrow(/Não consegui acessar/);
  });
});
