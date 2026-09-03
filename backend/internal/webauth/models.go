package webauth

import "time"

type LoginTransaction struct {
	StateHash    [32]byte
	BindingHash  [32]byte
	Nonce        string
	CodeVerifier string
	ReturnTo     string
	ExpiresAt    time.Time
}

type TelegramIdentity struct {
	Issuer              string
	Subject             string
	TelegramID          int64
	Name                string
	GivenName           string
	FamilyName          string
	Username            string
	PictureURL          string
	PhoneNumber         string
	PhoneNumberVerified bool
}

type User struct {
	ID          int64     `json:"id"`
	TelegramID  int64     `json:"telegramId"`
	Name        string    `json:"name"`
	GivenName   string    `json:"givenName,omitempty"`
	FamilyName  string    `json:"familyName,omitempty"`
	Username    string    `json:"username,omitempty"`
	PictureURL  string    `json:"pictureUrl,omitempty"`
	PhoneNumber string    `json:"phoneNumber"`
	ExpiresAt   time.Time `json:"sessionExpiresAt"`
}

// MeResponse is the privacy-minimal public representation of a signed-in
// user. The database identifier is intentionally kept out of this API.
type MeResponse struct {
	TelegramID          int64     `json:"telegramId"`
	Name                string    `json:"name"`
	GivenName           string    `json:"givenName,omitempty"`
	FamilyName          string    `json:"familyName,omitempty"`
	Username            string    `json:"username,omitempty"`
	PhoneNumberVerified bool      `json:"phoneNumberVerified"`
	ExpiresAt           time.Time `json:"sessionExpiresAt"`
}

func publicUser(user User) MeResponse {
	return MeResponse{
		TelegramID: user.TelegramID, Name: user.Name, GivenName: user.GivenName,
		FamilyName: user.FamilyName, Username: user.Username,
		PhoneNumberVerified: true, ExpiresAt: user.ExpiresAt,
	}
}
