Luminary OS — local models folder
==================================

Drop GGUF model files (*.gguf) anywhere in this folder — subfolders
are fine and are scanned recursively:

    models/
        llama/
            llama3.gguf
        coding/
            deepseek.gguf

Models appear on the Models page automatically while Luminary is
running (no restart or refresh needed). Files are never moved,
copied, or modified — Luminary only reads them.

Download GGUF models from https://huggingface.co (look for .gguf
files on model pages, e.g. "TheBloke" or "bartowski" repositories).
