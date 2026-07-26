import asyncio
import importlib
import logging
import sys
import tempfile
import types
import unittest
from unittest import mock


decky_stub = types.SimpleNamespace(
    DECKY_PLUGIN_SETTINGS_DIR="",
    logger=logging.getLogger("decky-speed-test-tests"),
)
sys.modules["decky"] = decky_stub
backend = importlib.import_module("main")


class BackendTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        decky_stub.DECKY_PLUGIN_SETTINGS_DIR = self.temporary_directory.name
        self.plugin = backend.Plugin()

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_resolves_ipv4_and_ipv6_hosts(self) -> None:
        ipv4_url, ipv4_protocol = backend._resolve_server("ustc", "ipv4")
        ipv6_url, ipv6_protocol = backend._resolve_server("ustc", "ipv6")

        self.assertEqual(ipv4_url, "https://test.ustc.edu.cn/")
        self.assertEqual(ipv4_protocol, "ipv4")
        self.assertEqual(ipv6_url, "https://test6.ustc.edu.cn/")
        self.assertEqual(ipv6_protocol, "ipv6")

    def test_nuaa_rejects_forced_protocols(self) -> None:
        for protocol in ("ipv4", "ipv6"):
            with self.subTest(protocol=protocol):
                with self.assertRaises(ValueError):
                    backend._resolve_server("nuaa", protocol)

    def test_extracts_anubis_script_data_without_html_parser(self) -> None:
        page = """
        <script type="application/json" id="anubis_challenge">
          {"challenge":{"id":"test"}}
        </script>
        <script id='anubis_base_prefix' type='application/json'>"/guard"</script>
        """

        self.assertEqual(
            backend._extract_script_data(page, "anubis_challenge"),
            '{"challenge":{"id":"test"}}',
        )
        self.assertEqual(
            backend._extract_script_data(page, "anubis_base_prefix"),
            '"/guard"',
        )
        self.assertIsNone(backend._extract_script_data(page, "missing"))

    def test_ssl_context_uses_the_steamos_ca_bundle(self) -> None:
        context = object()
        first_path = backend._SYSTEM_CA_BUNDLE_PATHS[0]

        with mock.patch.object(
            backend.os.path,
            "isfile",
            side_effect=lambda path: path == first_path,
        ):
            with mock.patch.object(
                backend.ssl,
                "create_default_context",
                return_value=context,
            ) as create_context:
                self.assertIs(backend._create_ssl_context(), context)

        create_context.assert_called_once_with(cafile=first_path)

    def test_ssl_context_falls_back_to_python_defaults(self) -> None:
        context = object()

        with mock.patch.object(backend.os.path, "isfile", return_value=False):
            with mock.patch.object(
                backend.ssl,
                "create_default_context",
                return_value=context,
            ) as create_context:
                self.assertIs(backend._create_ssl_context(), context)

        create_context.assert_called_once_with()

    def test_nuaa_uses_a_shorter_connection_timeout(self) -> None:
        ustc_session = backend._NetworkSession("https://test.ustc.edu.cn/")
        nuaa_session = backend._NetworkSession("http://speed.nuaa.edu.cn/")

        self.assertEqual(
            ustc_session.timeout_seconds,
            backend._HTTPS_TIMEOUT_SECONDS,
        )
        self.assertEqual(
            nuaa_session.timeout_seconds,
            backend._NUAA_TIMEOUT_SECONDS,
        )

    def test_forced_protocol_preferences_remove_unsupported_node(self) -> None:
        preferences = backend._sanitize_preferences(
            {
                "mode": "average",
                "singleServer": "nuaa",
                "selectedServers": ["ustc", "nuaa"],
                "protocol": "ipv4",
            }
        )

        self.assertEqual(preferences["singleServer"], "ustc")
        self.assertEqual(preferences["selectedServers"], ["ustc"])
        self.assertEqual(preferences["protocol"], "ipv4")

    def test_preferences_round_trip(self) -> None:
        stored = asyncio.run(
            self.plugin.save_preferences(
                {
                    "mode": "average",
                    "singleServer": "nju",
                    "selectedServers": ["nju", "ustc"],
                    "protocol": "ipv4",
                }
            )
        )
        loaded = asyncio.run(self.plugin.get_preferences())

        self.assertEqual(loaded, stored)

    def test_history_is_newest_first_and_limited(self) -> None:
        for index in range(55):
            asyncio.run(
                self.plugin.save_history(
                    {
                        "id": f"record-{index}",
                        "measuredAt": f"2026-07-26T08:{index:02d}:00Z",
                        "nodes": [],
                    }
                )
            )

        history = asyncio.run(self.plugin.get_history())
        self.assertEqual(len(history), 50)
        self.assertEqual(history[0]["id"], "record-54")
        self.assertEqual(history[-1]["id"], "record-5")


if __name__ == "__main__":
    unittest.main()
