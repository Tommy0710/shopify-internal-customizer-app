export type LoadOutcome<T> =
  | { status: "ready"; value: T }
  | { status: "stale" }
  | { status: "error"; error: unknown };

/**
 * Bọc một hàm đọc bất đồng bộ sao cho CHỈ kết quả của lần gọi mới nhất được
 * phép commit.
 *
 * Vấn đề nó giải: khách đổi animal hai lần liên tiếp; request đầu chậm hơn và
 * trả về SAU request thứ hai. Không có guard, kết quả cũ ghi đè lựa chọn mới
 * và preview hiển thị sai con vật (guide §7).
 *
 * Lần gọi cũ nhận `{status:"stale"}` — kể cả khi nó thất bại — nên caller
 * không bao giờ hiện lỗi của một lựa chọn khách đã bỏ.
 *
 * Port từ `test svg/src/mockups.js`.
 */
export function createMockupLoader<K, V>(
  read: (key: K) => Promise<V>,
): (key: K) => Promise<LoadOutcome<V>> {
  let sequence = 0;

  return async (key: K): Promise<LoadOutcome<V>> => {
    const request = ++sequence;
    try {
      const value = await read(key);
      return request === sequence ? { status: "ready", value } : { status: "stale" };
    } catch (error) {
      return request === sequence ? { status: "error", error } : { status: "stale" };
    }
  };
}
