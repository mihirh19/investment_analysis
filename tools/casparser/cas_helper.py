"""Bundled CAS PDF parser helper for Family Portfolio.

Compiled with PyInstaller into resources/bin/casparser.exe. The Electron
main process runs it once per import:

    casparser.exe <path-to-pdf>        (PDF password on stdin)

and reads a single JSON object from stdout:

    {"ok": true,  "data": {...casparser output...}}
    {"ok": false, "error": "<code>", "message": "..."}

Error codes: bad_args, file_not_found, wrong_password, parse_error, internal.
The password is read from stdin so it never appears in the process list.
"""

import json
import os
import sys


def emit(payload: dict, code: int) -> None:
    sys.stdout.write(json.dumps(payload))
    sys.stdout.flush()
    sys.exit(code)


def main() -> None:
    if len(sys.argv) != 2:
        emit({"ok": False, "error": "bad_args", "message": "usage: casparser.exe <pdf>"}, 2)

    pdf_path = sys.argv[1]
    if not os.path.isfile(pdf_path):
        emit({"ok": False, "error": "file_not_found", "message": pdf_path}, 2)

    password = sys.stdin.readline().rstrip("\r\n")

    from casparser import read_cas_pdf
    from casparser.exceptions import CASParseError, IncorrectPasswordError

    try:
        data_json = read_cas_pdf(pdf_path, password, output="json")
    except IncorrectPasswordError as e:
        emit({"ok": False, "error": "wrong_password", "message": str(e)}, 1)
    except CASParseError as e:
        emit({"ok": False, "error": "parse_error", "message": str(e)}, 1)
    except Exception as e:  # noqa: BLE001 - report anything else to the app
        emit({"ok": False, "error": "internal", "message": f"{type(e).__name__}: {e}"}, 1)

    sys.stdout.write('{"ok": true, "data": ')
    sys.stdout.write(data_json)
    sys.stdout.write("}")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
