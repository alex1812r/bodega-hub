export function jsonData<T>(data: T, init?: ResponseInit) {
  return Response.json({ data }, init);
}

export function jsonCreated<T>(data: T) {
  return jsonData(data, { status: 201 });
}
