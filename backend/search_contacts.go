package main

// This file provides contact search functionality by accessing libgm's unexported
// sessionHandler to send a ListContactsRequest with an undocumented query field (field 4).
// The query field was discovered by intercepting messages.google.com's protocol traffic.

import (
	"fmt"
	"reflect"
	"unsafe"

	"go.mau.fi/mautrix-gmessages/pkg/libgm"
	"go.mau.fi/mautrix-gmessages/pkg/libgm/gmproto"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
)

// sessionHandlerSendMessage calls the unexported (*SessionHandler).sendMessage
// using unsafe pointer arithmetic. We extract the sessionHandler pointer from
// the Client struct, then use go:linkname to call the method directly.
//
//go:linkname sessionHandlerSendMessage go.mau.fi/mautrix-gmessages/pkg/libgm.(*SessionHandler).sendMessage
func sessionHandlerSendMessage(s unsafe.Pointer, actionType gmproto.ActionType, encryptedData proto.Message) (*libgm.IncomingRPCMessage, error)

// getSessionHandlerPtr extracts the unexported sessionHandler pointer from a libgm.Client.
func getSessionHandlerPtr(cli *libgm.Client) unsafe.Pointer {
	v := reflect.ValueOf(cli).Elem()
	f := v.FieldByName("sessionHandler")
	return unsafe.Pointer(f.Pointer())
}

// SearchContacts searches the phone's contact list by name using the undocumented
// query field (protobuf field 4) on ListContactsRequest.
func (c *GMClient) SearchContacts(query string) ([]ContactResponse, error) {
	cli := c.GetClient()
	if cli == nil {
		return nil, fmt.Errorf("not connected")
	}

	req := &gmproto.ListContactsRequest{
		I1: 1,
		I2: 50,
		I3: 50,
	}

	if query != "" {
		// Inject field 4 (search query) as an unknown protobuf field.
		// This field is not defined in the .proto file but is used by
		// messages.google.com to search the phone's full contact list.
		var extra []byte
		extra = protowire.AppendTag(extra, 4, protowire.BytesType)
		extra = protowire.AppendString(extra, query)
		req.ProtoReflect().SetUnknown(extra)
	}

	shPtr := getSessionHandlerPtr(cli)
	msg, err := sessionHandlerSendMessage(shPtr, gmproto.ActionType_LIST_CONTACTS, req)
	if err != nil {
		return nil, fmt.Errorf("failed to search contacts: %w", err)
	}

	if msg == nil || msg.DecryptedMessage == nil {
		return []ContactResponse{}, nil
	}

	resp, ok := msg.DecryptedMessage.(*gmproto.ListContactsResponse)
	if !ok {
		return nil, fmt.Errorf("unexpected response type: %T", msg.DecryptedMessage)
	}

	var contacts []ContactResponse
	for _, contact := range resp.GetContacts() {
		cr := ConvertContact(contact)
		contacts = append(contacts, cr)
	}

	if contacts == nil {
		contacts = []ContactResponse{}
	}
	return contacts, nil
}
