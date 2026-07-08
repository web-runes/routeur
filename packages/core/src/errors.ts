/** Thrown by {@link redirect}; caught in dispatch (spec §7.5). */
export class Redirect {
	readonly location: string;
	readonly status: number;
	constructor(location: string, status: number) {
		this.location = location;
		this.status = status;
	}
}

/** Thrown by {@link error}; caught in dispatch and rendered as the catch-all page (spec §7.5). */
export class HttpError {
	readonly status: number;
	readonly body?: BodyInit;
	constructor(status: number, body?: BodyInit) {
		this.status = status;
		this.body = body;
	}
}

/** Abort with a bodyless redirect (spec §7). */
export function redirect(
	location: string,
	status: 301 | 302 | 303 | 307 | 308 = 302,
): never {
	throw new Redirect(location, status);
}

/** Abort and render the designated catch-all page at `status` (spec §7, §7.4). */
export function error(status: number, body?: BodyInit): never {
	throw new HttpError(status, body);
}
