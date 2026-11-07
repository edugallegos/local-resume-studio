export type StoreErrorCode =
	| "INVALID_ID"
	| "INVALID_DATA"
	| "INVALID_PDF"
	| "NOT_FOUND"
	| "EXISTS"
	| "CONFLICT"
	| "UNSAFE_PATH"
	| "IO_ERROR";

/** Base class for every expected local storage failure. */
export class StoreError extends Error {
	readonly code: StoreErrorCode;

	constructor(message: string, code: StoreErrorCode, options?: ErrorOptions) {
		super(message, options);
		this.name = new.target.name;
		this.code = code;
	}
}

export class InvalidResumeIdError extends StoreError {
	constructor(message = "Resume IDs must be lowercase slugs such as 'ada-lovelace'.", options?: ErrorOptions) {
		super(message, "INVALID_ID", options);
	}
}

export class ResumeValidationError extends StoreError {
	constructor(message = "Resume data does not match the pinned Reactive Resume schema.", options?: ErrorOptions) {
		super(message, "INVALID_DATA", options);
	}
}

export class ResumeNotFoundError extends StoreError {
	constructor(message = "Resume file was not found.", options?: ErrorOptions) {
		super(message, "NOT_FOUND", options);
	}
}

export class ResumeExistsError extends StoreError {
	constructor(message = "A resume with this label already exists.", options?: ErrorOptions) {
		super(message, "EXISTS", options);
	}
}

/** Raised when a caller writes against a stale ETag. Existing bytes are never changed. */
export class ResumeConflictError extends StoreError {
	constructor(message = "The resume changed on disk since it was read.", options?: ErrorOptions) {
		super(message, "CONFLICT", options);
	}
}

export class UnsafeResumePathError extends StoreError {
	constructor(message = "Refusing to access a symlink or unsafe resume path.", options?: ErrorOptions) {
		super(message, "UNSAFE_PATH", options);
	}
}

export class ResumeStorageError extends StoreError {
	constructor(message = "The local resume storage operation failed.", options?: ErrorOptions) {
		super(message, "IO_ERROR", options);
	}
}

export class InvalidPdfError extends StoreError {
	constructor(message = "The PDF export is not a valid, bounded PDF byte array.", options?: ErrorOptions) {
		super(message, "INVALID_PDF", options);
	}
}
