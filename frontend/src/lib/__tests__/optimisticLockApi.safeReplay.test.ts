import { describe, expect, it, vi } from "vitest";
import { putWithReconcile } from "@/lib/optimisticLockApi";

function conflict(currentVersion = 9) {
  return Object.assign(new Error("Version conflict"), {
    status: 409,
    code: "VERSION_CONFLICT",
    currentVersion,
  });
}

describe("putWithReconcile safe conflict handling", () => {
  it("does not replay a stale payload against the latest revision by default", async () => {
    const send = vi.fn().mockRejectedValue(conflict(9));

    await expect(putWithReconcile({
      initialVersion: 3,
      send,
    })).rejects.toMatchObject({
      status: 409,
      currentVersion: 9,
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(3);
  });

  it("may retry only when a caller explicitly marks the mutation replay-safe", async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(conflict(9))
      .mockResolvedValueOnce({ version: 10 });

    await expect(putWithReconcile({
      initialVersion: 3,
      send,
      retryOnConflict: true,
    })).resolves.toEqual({ version: 10 });

    expect(send).toHaveBeenNthCalledWith(1, 3);
    expect(send).toHaveBeenNthCalledWith(2, 9);
  });

  it("enriches the conflict with the latest revision without sending again", async () => {
    const error = Object.assign(new Error("409"), { status: 409 });
    const send = vi.fn().mockRejectedValue(error);
    const fetchLatestVersion = vi.fn().mockResolvedValue(12);

    await expect(putWithReconcile({
      initialVersion: 5,
      send,
      fetchLatestVersion,
    })).rejects.toMatchObject({ currentVersion: 12 });

    expect(send).toHaveBeenCalledTimes(1);
    expect(fetchLatestVersion).toHaveBeenCalledTimes(1);
  });
});
