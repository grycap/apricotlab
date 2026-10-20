import json
from unittest.mock import Mock

import pytest

from apricot_magics.apricot_magics import Apricot_Magics, load_ipython_extension


@pytest.fixture
def magics(tmp_path, monkeypatch):
    """Build the magics with an isolated state directory and no credentials."""
    monkeypatch.setattr("pathlib.Path.home", lambda: tmp_path)
    return Apricot_Magics(shell=None)


def test_extension_registers_apricot_magics():
    ipython = Mock()

    load_ipython_extension(ipython)

    ipython.register_magics.assert_called_once_with(Apricot_Magics)


def test_state_requires_an_infrastructure_id(magics):
    assert magics.apricot_state("") == "Usage: `%apricot_state <infrastructure-id>`\n"


def test_state_prints_aggregate_and_vm_states(magics, monkeypatch, capsys):
    client = Mock()
    client.get_infra_property.return_value = (
        True,
        {"state": "running", "vm_states": {"0": "running", "1": "stopped"}},
    )
    monkeypatch.setattr(magics, "initialize_im_client", Mock())
    magics.client = client

    result = magics.apricot_state("inf-123 ignored-argument")

    assert result is None
    client.get_infra_property.assert_called_once_with("inf-123", "state")
    output = capsys.readouterr().out
    assert "State: running" in output
    assert "VM ID" in output
    assert "0                    | running" in output
    assert "1                    | stopped" in output


def test_state_reports_client_errors(magics, monkeypatch, capsys):
    client = Mock()
    client.get_infra_property.return_value = (False, "infrastructure not found")
    monkeypatch.setattr(magics, "initialize_im_client", Mock())
    magics.client = client

    assert magics.apricot_state("missing") == "Failed"
    assert "Error: infrastructure not found" in capsys.readouterr().out


def test_token_saves_new_refresh_token(magics, monkeypatch):
    generate = Mock(return_value="access-token")
    monkeypatch.setattr(magics, "generate_new_access_token", generate)

    magics.apricot_token("  new-refresh-token  ")

    data = json.loads(magics.inf_list_path.read_text())
    assert data["refresh_token"] == "new-refresh-token"
    generate.assert_called_once_with("new-refresh-token")


def test_ls_prints_infrastructure_data(magics, monkeypatch, capsys):
    magics.inf_list_path.write_text(
        json.dumps(
            {
                "refresh_token": "",
                "infrastructures": [
                    {"name": "cluster", "infrastructureID": "inf-1"}
                ],
            }
        )
    )
    monkeypatch.setattr(magics, "get_infrastructure_state", Mock(return_value="running"))
    monkeypatch.setattr(magics, "get_vm_ip", Mock(return_value="192.0.2.10"))

    magics.apricot_ls("")

    output = capsys.readouterr().out
    assert "cluster" in output
    assert "inf-1" in output
    assert "192.0.2.10" in output
    assert "running" in output


def test_create_detects_json_and_persists_the_new_infrastructure(
    magics, monkeypatch, capsys
):
    client = Mock()
    client.create.return_value = (True, "inf-new")
    monkeypatch.setattr(magics, "initialize_im_client", Mock())
    magics.client = client

    magics.apricot_create('{"network": {}}')

    client.create.assert_called_once_with('{"network": {}}', "json")
    data = json.loads(magics.inf_list_path.read_text())
    assert data["infrastructures"] == [{"infrastructureID": "inf-new"}]
    assert "inf-new successfully created" in capsys.readouterr().out


@pytest.mark.parametrize(
    ("method_name", "transfer_type"),
    [("apricot_upload", "upload"), ("apricot_download", "download")],
)
def test_transfer_magics_parse_arguments(magics, monkeypatch, method_name, transfer_type):
    transfer = Mock(return_value="Done")
    monkeypatch.setattr(magics, "apricot_transfer", transfer)

    result = getattr(magics, method_name)("inf-1 first.txt second.txt /destination")

    assert result == "Done"
    transfer.assert_called_once_with(
        "inf-1",
        "0",
        ["first.txt", "second.txt"],
        "/destination",
        transfer_type=transfer_type,
    )


def test_apricot_line_magic_dispatches_state(magics, monkeypatch):
    state = Mock(return_value=None)
    monkeypatch.setattr(magics, "apricot_state", state)

    assert magics.apricot("state inf-1") is None
    state.assert_called_once_with("inf-1")


def test_apricot_cell_magic_stops_after_a_failed_line(magics, monkeypatch, capsys):
    line_magic = Mock(side_effect=[None, "Fail"])
    monkeypatch.setattr(magics, "apricot", line_magic)

    result = Apricot_Magics.apricot(magics, "", "list\nstate invalid\nlist")

    assert result == "Fail on line: 'state invalid'"
    assert line_magic.call_count == 2
    assert "Execution stopped" in capsys.readouterr().out
